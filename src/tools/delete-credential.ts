import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";
import { stripCredentialData } from "./redact-credential.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description: "Credential id (from n8n_list_credentials).",
    }),
    confirm: Type.Boolean({
      description:
        "Must be true to actually delete. Cascades — every workflow that references this credential will start failing on its next run.",
    }),
  },
  { additionalProperties: false },
);

export function createDeleteCredentialTool(getClient: () => N8nClient) {
  return {
    name: "n8n_delete_credential",
    label: "n8n: delete credential",
    description:
      "Permanently delete a credential via DELETE /credentials/{id}. **Double-gated**: requires both enableEdit AND enableCredentialsWrite (default false). Confirm-gated. Cascade: deleting a credential breaks every workflow that references it — RUN n8n_find_workflows_using_credential FIRST to enumerate the blast radius. 404 on unknown id returns `{ ok: false, reason: 'not_found' }`. The deleted-credential payload echoed by n8n has `data` stripped at the tool layer regardless.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id, confirm } = rawParams as { id: string; confirm: boolean };
      if (!confirm) {
        return jsonToolResult({
          ok: false,
          action: "delete_credential",
          error: "confirm must be true to delete",
          hint: "Run n8n_find_workflows_using_credential first to see which workflows reference this credential — they will all start failing on their next run after the delete.",
        });
      }
      const client = getClient();
      try {
        const deleted = await client.deleteCredential(id);
        return jsonToolResult({
          ok: true,
          action: "delete_credential",
          deleted: stripCredentialData(deleted),
        });
      } catch (err) {
        if (err instanceof N8nApiError && err.status === 404) {
          return jsonToolResult({
            ok: false,
            action: "delete_credential",
            reason: "not_found",
            id,
          });
        }
        if (err instanceof N8nApiError && err.status === 401) {
          return jsonToolResult({
            ok: false,
            action: "delete_credential",
            reason: "unauthorized",
            error: client.redact(err.message),
            hint: "DELETE /credentials/{id} requires the API key to belong to an instance owner or admin (and you must own the credential).",
          });
        }
        throw err;
      }
    },
  };
}
