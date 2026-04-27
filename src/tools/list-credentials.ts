import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";
import { stripCredentialData } from "./redact-credential.ts";

const Schema = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 250,
        description: "Max credentials returned (default 100).",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        description:
          "Pagination cursor from a previous call's `nextCursor`. Omit on first page.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createListCredentialsTool(getClient: () => N8nClient) {
  return {
    name: "n8n_list_credentials",
    label: "n8n: list credentials",
    description:
      "List credentials via GET /credentials. Returns metadata only — n8n's API explicitly excludes the `data` field (the encrypted secrets). Each row: {id, name, type (e.g. 'githubApi'), createdAt, updatedAt, shared[]}. Read-only. Requires the API user to be an instance owner or admin — non-admin keys get 401 with a clear hint. The tool defensively strips any `data` field that might appear in a future regression.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { limit, cursor } = rawParams as {
        limit?: number;
        cursor?: string;
      };
      const client = getClient();
      try {
        const page = await client.listCredentials({ limit, cursor });
        const sanitized = page.data.map(stripCredentialData);
        return jsonToolResult({
          count: sanitized.length,
          nextCursor: page.nextCursor ?? null,
          data: sanitized,
        });
      } catch (err) {
        if (err instanceof N8nApiError && err.status === 401) {
          return jsonToolResult({
            ok: false,
            action: "list_credentials",
            reason: "unauthorized",
            error: client.redact(err.message),
            hint: "GET /credentials requires the API key to belong to an instance owner or admin. Generate a new API key from an admin account, or use n8n_run_audit which also lists credentials and works with any API key.",
          });
        }
        throw err;
      }
    },
  };
}
