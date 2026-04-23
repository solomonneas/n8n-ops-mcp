import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description: "Workflow id (from n8n_list_workflows).",
    }),
  },
  { additionalProperties: false },
);

type Severity = "error" | "warning" | "info";

interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  nodeName?: string;
  nodeType?: string;
}

const DEPRECATED_NODE_TYPES: Record<string, string> = {
  "n8n-nodes-base.function": "n8n-nodes-base.code",
  "n8n-nodes-base.functionItem": "n8n-nodes-base.code",
};

const TRIGGER_TYPE_MARKERS = [
  "trigger",
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.executeWorkflowTrigger",
];

export function createValidateWorkflowTool(getClient: () => N8nClient) {
  return {
    name: "n8n_validate_workflow",
    label: "n8n: validate workflow",
    description:
      "Static checks on a workflow: deprecated node types (function → code), old Code-node API usage ($node[], items global, require()), orphan nodes, disabled nodes, and missing trigger. Returns a list of issues with severity.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id } = rawParams as { id: string };
      const wf = await getClient().getWorkflow(id);
      const issues = validateWorkflow(wf);
      const summary = summarize(issues);
      return jsonToolResult({
        workflowId: wf.id,
        workflowName: wf.name,
        active: wf.active,
        nodeCount: Array.isArray(wf.nodes) ? wf.nodes.length : 0,
        summary,
        issues,
      });
    },
  };
}

export function validateWorkflow(wf: N8nWorkflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];

  const triggerNodes = nodes.filter((n) => isTriggerNode(n));
  if (triggerNodes.length === 0) {
    issues.push({
      severity: "error",
      code: "missing-trigger",
      message: "Workflow has no trigger node and cannot be executed.",
    });
  }

  const incoming = buildIncomingIndex(wf.connections);

  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    const name = typeof node.name === "string" ? node.name : "<unnamed>";
    const type = typeof node.type === "string" ? node.type : "";
    const disabled = node.disabled === true;

    const replacement = DEPRECATED_NODE_TYPES[type];
    if (replacement) {
      issues.push({
        severity: "warning",
        code: "deprecated-node-type",
        message: `Node type '${type}' is deprecated. Migrate to '${replacement}'.`,
        nodeName: name,
        nodeType: type,
      });
    }

    if (type === "n8n-nodes-base.code" || type === "n8n-nodes-base.function") {
      const codeIssues = checkCodeNode(node, name, type);
      issues.push(...codeIssues);
    }

    if (disabled) {
      issues.push({
        severity: "info",
        code: "disabled-node",
        message: `Node '${name}' is disabled; downstream branches will be skipped.`,
        nodeName: name,
        nodeType: type,
      });
    }

    if (!isTriggerNode(node) && !incoming.has(name)) {
      issues.push({
        severity: "warning",
        code: "orphan-node",
        message: `Node '${name}' has no incoming connections and is not a trigger. It will never execute.`,
        nodeName: name,
        nodeType: type,
      });
    }
  }

  return issues;
}

function checkCodeNode(
  node: Record<string, unknown>,
  name: string,
  type: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const params = (node.parameters as Record<string, unknown>) ?? {};
  const code = collectCodeStrings(params);
  if (!code) return issues;

  if (/\brequire\s*\(/.test(code)) {
    issues.push({
      severity: "warning",
      code: "code-node-require",
      message: `Code node '${name}' calls require(); n8n blocks this unless NODE_FUNCTION_ALLOW_EXTERNAL is set on the host.`,
      nodeName: name,
      nodeType: type,
    });
  }
  if (/\$node\s*\[/.test(code)) {
    issues.push({
      severity: "warning",
      code: "code-node-old-node-ref",
      message: `Code node '${name}' uses $node[...] (legacy API). Prefer $('Node Name').`,
      nodeName: name,
      nodeType: type,
    });
  }
  if (/(^|[^.\w$])items(\s*\[|\s*\.|\s*;|\s*\))/m.test(code)) {
    issues.push({
      severity: "warning",
      code: "code-node-items-global",
      message: `Code node '${name}' references the 'items' global (removed in n8n v1). Use $input.all() or $input.first().`,
      nodeName: name,
      nodeType: type,
    });
  }
  return issues;
}

function collectCodeStrings(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["jsCode", "functionCode", "code", "pythonCode"]) {
    const v = params[key];
    if (typeof v === "string") parts.push(v);
  }
  return parts.join("\n");
}

function buildIncomingIndex(connections: unknown): Set<string> {
  const incoming = new Set<string>();
  if (!connections || typeof connections !== "object") return incoming;
  for (const outputs of Object.values(connections as Record<string, unknown>)) {
    if (!outputs || typeof outputs !== "object") continue;
    for (const outputBranches of Object.values(outputs as Record<string, unknown>)) {
      if (!Array.isArray(outputBranches)) continue;
      for (const branch of outputBranches) {
        if (!Array.isArray(branch)) continue;
        for (const edge of branch) {
          if (edge && typeof edge === "object" && "node" in edge) {
            const target = (edge as { node: unknown }).node;
            if (typeof target === "string") incoming.add(target);
          }
        }
      }
    }
  }
  return incoming;
}

function isTriggerNode(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const n = raw as Record<string, unknown>;
  const type = typeof n.type === "string" ? n.type.toLowerCase() : "";
  if (!type) return false;
  return TRIGGER_TYPE_MARKERS.some((marker) => type.includes(marker));
}

function summarize(issues: ValidationIssue[]): {
  errors: number;
  warnings: number;
  info: number;
  ok: boolean;
} {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else info++;
  }
  return { errors, warnings, info, ok: errors === 0 };
}
