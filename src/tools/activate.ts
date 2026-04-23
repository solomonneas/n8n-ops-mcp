import { Type } from "@sinclair/typebox";
import type { N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({ description: "Workflow id to activate." }),
  },
  { additionalProperties: false },
);

export function createActivateTool(getClient: () => N8nClient) {
  return {
    name: "n8n_activate",
    label: "n8n: activate workflow",
    description:
      "Activate an n8n workflow so its triggers (webhooks, schedules, polling) start running. Idempotent - activating an already-active workflow returns the current state. Requires enableEdit.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id } = rawParams as { id: string };
      const wf = await getClient().activateWorkflow(id);
      return jsonToolResult({
        ok: true,
        action: "activate",
        workflowId: wf.id,
        workflowName: wf.name,
        active: wf.active,
        updatedAt: wf.updatedAt,
      });
    },
  };
}
