import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    nodeType: Type.String({
      minLength: 1,
      description:
        "n8n node type to search for (e.g. 'n8n-nodes-base.slack', 'n8n-nodes-base.httpRequest', '@n8n/n8n-nodes-langchain.agent'). Exact match unless `match` is set to 'contains'.",
    }),
    match: Type.Optional(
      Type.Union(
        [Type.Literal("exact"), Type.Literal("contains")],
        {
          description:
            "Match mode (default 'exact'). 'contains' is case-insensitive substring match — useful for finding 'all Slack nodes' across base + community packages.",
        },
      ),
    ),
    activeOnly: Type.Optional(
      Type.Boolean({
        description:
          "Only scan active workflows. Default false — inactive workflows still represent real callsites worth surfacing.",
      }),
    ),
    includeArchived: Type.Optional(
      Type.Boolean({
        description: "Include archived workflows in the scan. Default false.",
      }),
    ),
    includeDisabledNodes: Type.Optional(
      Type.Boolean({
        description:
          "Include nodes that are disabled in the workflow. Default true — disabled nodes are common drift signals.",
      }),
    ),
    maxWorkflows: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 1000,
        description:
          "Cap on workflows fetched and inspected (default 250).",
      }),
    ),
    concurrency: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 8,
        description:
          "Parallel getWorkflow requests (default 3, max 8).",
      }),
    ),
  },
  { additionalProperties: false },
);

const PAGE_SIZE = 100;
const DEFAULT_MAX_WORKFLOWS = 250;
const DEFAULT_CONCURRENCY = 3;

export interface NodeMatch {
  workflowId: string;
  workflowName: string;
  active: boolean;
  archived: boolean;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
  disabled: boolean;
}

export interface FindWorkflowsUsingNodeTypeOptions {
  nodeType: string;
  match?: "exact" | "contains";
  activeOnly?: boolean;
  includeArchived?: boolean;
  includeDisabledNodes?: boolean;
  maxWorkflows?: number;
  concurrency?: number;
}

export async function findWorkflowsUsingNodeType(
  client: N8nClient,
  opts: FindWorkflowsUsingNodeTypeOptions,
): Promise<Record<string, unknown>> {
  const target = opts.nodeType.trim();
  if (!target) {
    // Defensive: with `match: "contains"`, an empty string would match
    // every node and produce a useless dump. MCP schema enforces minLength:1
    // but the runtime trim opens this gap.
    return {
      ok: false,
      reason: "empty_node_type",
      error: "nodeType must be non-empty after trim",
    };
  }
  const match = opts.match ?? "exact";
  const activeOnly = opts.activeOnly === true;
  const includeArchived = opts.includeArchived === true;
  const includeDisabled = opts.includeDisabledNodes !== false;
  const maxWorkflows = opts.maxWorkflows ?? DEFAULT_MAX_WORKFLOWS;
  const concurrency = Math.max(
    1,
    Math.min(8, opts.concurrency ?? DEFAULT_CONCURRENCY),
  );
  const targetLower = target.toLowerCase();

  {
      const summaries: Array<{ id: string; archived: boolean }> = [];
      let cursor: string | undefined;
      let truncated = false;
      while (summaries.length < maxWorkflows) {
        const remaining = maxWorkflows - summaries.length;
        const limit = Math.min(PAGE_SIZE, remaining);
        const page = await client.listWorkflows({
          active: activeOnly ? true : undefined,
          limit,
          cursor,
        });
        for (const w of page.data) {
          const archived = w.isArchived === true;
          if (archived && !includeArchived) continue;
          summaries.push({ id: String(w.id), archived });
          if (summaries.length >= maxWorkflows) break;
        }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (page.data.length === 0) break;
      }
      if (cursor) truncated = true;

      const definitions: N8nWorkflow[] = [];
      const fetchErrors: Array<{ workflowId: string; error: string }> = [];
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const i = nextIndex++;
          if (i >= summaries.length) return;
          const id = summaries[i].id;
          try {
            definitions.push(await client.getWorkflow(id));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            fetchErrors.push({ workflowId: id, error: client.redact(msg) });
          }
        }
      };
      const pool: Promise<void>[] = [];
      for (let i = 0; i < Math.min(concurrency, summaries.length); i++) {
        pool.push(worker());
      }
      await Promise.all(pool);

      const findings: NodeMatch[] = [];
      const perWorkflow = new Map<
        string,
        { workflowName: string; active: boolean; archived: boolean; matchCount: number }
      >();
      for (const wf of definitions) {
        if (!Array.isArray(wf.nodes)) continue;
        let wfMatchCount = 0;
        for (const rawNode of wf.nodes) {
          if (!rawNode || typeof rawNode !== "object") continue;
          const n = rawNode as Record<string, unknown>;
          const type = String(n.type ?? "");
          if (!type) continue;
          const matched =
            match === "exact"
              ? type === target
              : type.toLowerCase().includes(targetLower);
          if (!matched) continue;
          const disabled = n.disabled === true;
          if (disabled && !includeDisabled) continue;
          findings.push({
            workflowId: String(wf.id),
            workflowName: wf.name,
            active: wf.active,
            archived: wf.isArchived === true,
            nodeId: typeof n.id === "string" ? n.id : null,
            nodeName: typeof n.name === "string" ? n.name : "",
            nodeType: type,
            disabled,
          });
          wfMatchCount++;
        }
        if (wfMatchCount > 0) {
          perWorkflow.set(String(wf.id), {
            workflowName: wf.name,
            active: wf.active,
            archived: wf.isArchived === true,
            matchCount: wfMatchCount,
          });
        }
      }

      const summary = Array.from(perWorkflow.entries())
        .map(([id, v]) => ({
          workflowId: id,
          workflowName: v.workflowName,
          active: v.active,
          archived: v.archived,
          matchCount: v.matchCount,
        }))
        .sort((a, b) => b.matchCount - a.matchCount);

      return {
        target,
        match,
        scannedWorkflows: definitions.length,
        requestedMaxWorkflows: maxWorkflows,
        truncated,
        fetchErrors,
        workflowsWithMatches: summary.length,
        findingCount: findings.length,
        summary,
        findings,
      };
  }
}

export function createFindWorkflowsUsingNodeTypeTool(
  getClient: () => N8nClient,
) {
  return {
    name: "n8n_find_workflows_using_node_type",
    label: "n8n: find workflows using node type",
    description:
      "Scan workflows and surface every node matching a given type (e.g. 'n8n-nodes-base.slack'). Returns one finding per matching node + a per-workflow summary so agents can answer 'where am I calling Slack?' or 'which workflows still use the legacy HTTP Request node?' without grepping the n8n DB. Read-only. Bounded-concurrency fan-out; per-workflow fetch errors land in `fetchErrors` instead of failing the whole scan.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await findWorkflowsUsingNodeType(
          getClient(),
          rawParams as unknown as FindWorkflowsUsingNodeTypeOptions,
        ),
      );
    },
  };
}
