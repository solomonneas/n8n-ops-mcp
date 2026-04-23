import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflowSummary } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    active: Type.Optional(
      Type.Boolean({ description: "Filter by active state. Omit for all." }),
    ),
    tags: Type.Optional(
      Type.String({ description: "Comma-separated tag names to filter by." }),
    ),
    name: Type.Optional(
      Type.String({ description: "Case-insensitive substring match on workflow name." }),
    ),
    limit: Type.Optional(
      Type.Number({ minimum: 1, maximum: 250, description: "Max rows (default 100)." }),
    ),
  },
  { additionalProperties: false },
);

export function createListWorkflowsTool(getClient: () => N8nClient) {
  return {
    name: "n8n_list_workflows",
    label: "n8n: list workflows",
    description:
      "List n8n workflows with optional filters. Returns id, name, active state, tags, updatedAt. Use n8n_get_workflow to pull the full definition.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as {
        active?: boolean;
        tags?: string;
        name?: string;
        limit?: number;
      };
      const res = await getClient().listWorkflows({
        active: params.active,
        tags: params.tags,
        limit: params.limit ?? 100,
      });
      const rows = res.data
        .filter((w) => matchName(w, params.name))
        .map(summaryRow);
      return jsonToolResult({
        count: rows.length,
        workflows: rows,
        nextCursor: res.nextCursor ?? null,
      });
    },
  };
}

function matchName(w: N8nWorkflowSummary, q?: string): boolean {
  if (!q) return true;
  return w.name.toLowerCase().includes(q.toLowerCase());
}

function summaryRow(w: N8nWorkflowSummary) {
  return {
    id: w.id,
    name: w.name,
    active: w.active,
    archived: w.isArchived === true,
    tags: (w.tags ?? []).map((t) => t.name),
    updatedAt: w.updatedAt,
  };
}
