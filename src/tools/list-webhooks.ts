import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    workflowId: Type.Optional(
      Type.String({
        description:
          "Restrict to a single workflow. Omit to scan recent workflows.",
      }),
    ),
    activeOnly: Type.Optional(
      Type.Boolean({
        description: "Only include active workflows. Default true.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 100,
        description:
          "When workflowId is omitted, max workflows to fetch and scan (default 50).",
      }),
    ),
  },
  { additionalProperties: false },
);

export interface ListWebhooksDeps {
  getClient: () => N8nClient;
  baseUrl: string;
}

export interface ListWebhooksOptions {
  workflowId?: string;
  activeOnly?: boolean;
  limit?: number;
}

export async function listWebhooks(
  client: N8nClient,
  baseUrl: string,
  opts: ListWebhooksOptions = {},
): Promise<Record<string, unknown>> {
  const activeOnly = opts.activeOnly !== false;

  const workflows: N8nWorkflow[] = [];
  if (opts.workflowId) {
    workflows.push(await client.getWorkflow(opts.workflowId));
  } else {
    const list = await client.listWorkflows({
      active: activeOnly ? true : undefined,
      limit: opts.limit ?? 50,
    });
    const defs = await Promise.all(
      list.data.map((w) => client.getWorkflow(w.id)),
    );
    workflows.push(...defs);
  }

  const webhooks: Record<string, unknown>[] = [];
  for (const wf of workflows) {
    if (activeOnly && !wf.active) continue;
    if (!Array.isArray(wf.nodes)) continue;
    for (const node of wf.nodes) {
      const hook = extractWebhook(node, wf, baseUrl);
      if (hook) webhooks.push(hook);
    }
  }

  return {
    count: webhooks.length,
    scannedWorkflows: workflows.length,
    activeOnly,
    webhooks,
  };
}

export function createListWebhooksTool(deps: ListWebhooksDeps) {
  return {
    name: "n8n_list_webhooks",
    label: "n8n: list webhooks",
    description:
      "Surface webhook and form-trigger paths from n8n workflows so agents can call n8n_trigger with mode='webhook' without opening the n8n UI. Returns workflowId, workflowName, nodeName, method, path, and a fully-formed triggerUrl.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await listWebhooks(
          deps.getClient(),
          deps.baseUrl,
          rawParams as ListWebhooksOptions,
        ),
      );
    },
  };
}

function extractWebhook(
  rawNode: unknown,
  wf: N8nWorkflow,
  baseUrl: string,
): Record<string, unknown> | null {
  if (!rawNode || typeof rawNode !== "object") return null;
  const n = rawNode as Record<string, unknown>;
  const type = String(n.type ?? "");
  const name = typeof n.name === "string" ? n.name : "";
  const params = (n.parameters as Record<string, unknown>) ?? {};
  const base = baseUrl.replace(/\/+$/, "");

  if (type === "n8n-nodes-base.webhook") {
    const pathRaw =
      typeof params.path === "string" && params.path.trim()
        ? params.path.trim()
        : typeof n.webhookId === "string"
          ? String(n.webhookId)
          : "";
    if (!pathRaw) return null;
    const path = pathRaw.replace(/^\/+/, "");
    const method =
      typeof params.httpMethod === "string" && params.httpMethod.trim()
        ? params.httpMethod.toUpperCase()
        : "POST";
    return {
      workflowId: wf.id,
      workflowName: wf.name,
      active: wf.active,
      nodeName: name,
      nodeType: type,
      method,
      path: `/webhook/${path}`,
      triggerUrl: `${base}/webhook/${path}`,
      testTriggerUrl: `${base}/webhook-test/${path}`,
    };
  }

  if (type === "n8n-nodes-base.formTrigger") {
    const pathRaw =
      typeof params.path === "string" && params.path.trim()
        ? params.path.trim()
        : typeof n.webhookId === "string"
          ? String(n.webhookId)
          : "";
    if (!pathRaw) return null;
    const path = pathRaw.replace(/^\/+/, "");
    return {
      workflowId: wf.id,
      workflowName: wf.name,
      active: wf.active,
      nodeName: name,
      nodeType: type,
      method: "POST",
      path: `/form/${path}`,
      triggerUrl: `${base}/form/${path}`,
    };
  }

  return null;
}
