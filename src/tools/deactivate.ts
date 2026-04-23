import { Type } from "@sinclair/typebox";
import type { N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({ description: "Workflow id to deactivate." }),
  },
  { additionalProperties: false },
);

export function createDeactivateTool(getClient: () => N8nClient) {
  return {
    name: "n8n_deactivate",
    label: "n8n: deactivate workflow",
    description:
      "Deactivate an n8n workflow so its triggers stop firing. Running executions are not cancelled. Idempotent. Requires enableEdit.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id } = rawParams as { id: string };
      const wf = await getClient().deactivateWorkflow(id);
      return jsonToolResult({
        ok: true,
        action: "deactivate",
        workflowId: wf.id,
        workflowName: wf.name,
        active: wf.active,
        updatedAt: wf.updatedAt,
      });
    },
  };
}
