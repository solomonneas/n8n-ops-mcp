import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({ description: "Workflow id (from n8n_list_workflows)." }),
    includeDefinition: Type.Optional(
      Type.Boolean({
        description:
          "Include full nodes+connections JSON. Off by default to keep responses small. Turn on when you need to inspect or edit the workflow.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createGetWorkflowTool(getClient: () => N8nClient) {
  return {
    name: "n8n_get_workflow",
    label: "n8n: get workflow",
    description:
      "Fetch a single n8n workflow by id. Returns metadata and optionally the full node graph. Resolves against the live workflow, not the workflow_entity row directly.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as { id: string; includeDefinition?: boolean };
      const wf: N8nWorkflow = await getClient().getWorkflow(params.id);
      const base = {
        id: wf.id,
        name: wf.name,
        active: wf.active,
        archived: wf.isArchived === true,
        tags: (wf.tags ?? []).map((t) => t.name),
        versionId: wf.versionId ?? null,
        nodeCount: Array.isArray(wf.nodes) ? wf.nodes.length : 0,
        nodeTypes: summarizeNodeTypes(wf.nodes),
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt,
      };
      if (!params.includeDefinition) {
        return jsonToolResult(base);
      }
      return jsonToolResult({
        ...base,
        definition: {
          nodes: wf.nodes,
          connections: wf.connections,
          settings: wf.settings ?? null,
          staticData: wf.staticData ?? null,
          pinData: wf.pinData ?? null,
        },
      });
    },
  };
}

function summarizeNodeTypes(nodes: unknown): Record<string, number> {
  if (!Array.isArray(nodes)) return {};
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    if (n && typeof n === "object" && "type" in n) {
      const t = String((n as { type: unknown }).type);
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return counts;
}
