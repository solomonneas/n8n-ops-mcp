import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";
import { stripCredentialData } from "./redact-credential.ts";

const Schema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        "Display name for the credential (e.g. 'GitHub - srneas'). Not required to be unique by n8n, but pick something distinctive.",
    }),
    type: Type.String({
      minLength: 1,
      description:
        "n8n credential type name (e.g. 'githubApi', 'slackOAuth2Api'). Match what n8n_get_credential_schema returned.",
    }),
    data: Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Credential body matching the JSON schema for `type` (from n8n_get_credential_schema). Contains plaintext secrets — never echo back. The tool layer redacts `data` from every response branch.",
    }),
    confirm: Type.Boolean({
      description:
        "Must be true to actually create. Even though creation isn't destructive, it injects secrets that may persist long-term — same blast-radius posture as a destructive tool.",
    }),
  },
  { additionalProperties: false },
);

export function createCreateCredentialTool(getClient: () => N8nClient) {
  return {
    name: "n8n_create_credential",
    label: "n8n: create credential",
    description:
      "Create a credential via POST /credentials. **Double-gated**: requires both enableEdit AND enableCredentialsWrite (default false). Confirm-gated. The `data` field carries plaintext secrets to n8n; the tool layer NEVER echoes `data` back, even on error — n8n 400s with body content are replaced with a status-only message before surfacing. Pre-call: use n8n_get_credential_schema to learn the required `data` shape for the credential type. Post-call: the response includes `id`, `name`, `type`, timestamps; no `data`. NOT idempotent — calling twice with the same name creates two credentials.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { name, type, data, confirm } = rawParams as {
        name: string;
        type: string;
        data: Record<string, unknown>;
        confirm: boolean;
      };
      if (!confirm) {
        return jsonToolResult({
          ok: false,
          action: "create_credential",
          error: "confirm must be true to create",
          hint: "Credential creation injects plaintext secrets that persist long-term in n8n's encrypted store. Confirm intent explicitly.",
        });
      }
      const trimmedName = name.trim();
      const trimmedType = type.trim();
      if (!trimmedName || !trimmedType) {
        return jsonToolResult({
          ok: false,
          action: "create_credential",
          reason: "empty_field",
          error: "name and type must be non-empty after trim",
        });
      }
      if (!data || typeof data !== "object") {
        return jsonToolResult({
          ok: false,
          action: "create_credential",
          reason: "invalid_data",
          error: "data must be an object",
        });
      }
      const client = getClient();
      try {
        const created = await client.createCredential({
          name: trimmedName,
          type: trimmedType,
          data,
        });
        return jsonToolResult({
          ok: true,
          action: "create_credential",
          credential: stripCredentialData(created),
        });
      } catch (err) {
        if (err instanceof N8nApiError) {
          // Defensive redaction. The client already strips n8n's response
          // body from the error message before re-throwing; we surface the
          // status + path only and never include any portion of the
          // request body the caller sent up.
          const reason =
            err.status === 400
              ? "bad_request"
              : err.status === 401
                ? "unauthorized"
                : err.status === 415
                  ? "unsupported_media_type"
                  : "api_error";
          return jsonToolResult({
            ok: false,
            action: "create_credential",
            reason,
            status: err.status,
            error: `n8n returned ${err.status} for POST /api/v1/credentials`,
            hint:
              err.status === 400
                ? "Likely an unknown credential type or a `data` shape that doesn't match the schema. Call n8n_get_credential_schema first."
                : err.status === 401
                  ? "POST /credentials requires the API key to belong to an instance owner or admin."
                  : undefined,
          });
        }
        throw err;
      }
    },
  };
}
