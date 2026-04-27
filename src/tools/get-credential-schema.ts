import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    credentialTypeName: Type.String({
      minLength: 1,
      description:
        "n8n credential type name (e.g. 'githubApi', 'slackOAuth2Api', 'freshdeskApi'). The same string used in the `type` field of every credential row.",
    }),
  },
  { additionalProperties: false },
);

export function createGetCredentialSchemaTool(getClient: () => N8nClient) {
  return {
    name: "n8n_get_credential_schema",
    label: "n8n: get credential schema",
    description:
      "Fetch the JSON schema for a credential type via GET /credentials/schema/{credentialTypeName}. Returns the raw JSON Schema document describing the required `data` shape (e.g. `freshdeskApi` requires { apiKey, domain }). Use this BEFORE calling n8n_create_credential so you know what fields to populate. 404 on unknown type returns `{ ok: false, reason: 'not_found' }`. 401 surfaces the admin/owner role requirement.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { credentialTypeName } = rawParams as {
        credentialTypeName: string;
      };
      const trimmed = credentialTypeName.trim();
      if (!trimmed) {
        return jsonToolResult({
          ok: false,
          action: "get_credential_schema",
          reason: "empty_type_name",
          error: "credentialTypeName must be non-empty after trim",
        });
      }
      const client = getClient();
      try {
        const schema = await client.getCredentialSchema(trimmed);
        return jsonToolResult({
          ok: true,
          credentialTypeName: trimmed,
          schema,
        });
      } catch (err) {
        if (err instanceof N8nApiError && err.status === 404) {
          return jsonToolResult({
            ok: false,
            action: "get_credential_schema",
            reason: "not_found",
            credentialTypeName: trimmed,
            hint: "Unknown credential type. Use n8n_list_credentials to see what types exist on this instance, or check n8n's docs.",
          });
        }
        if (err instanceof N8nApiError && err.status === 401) {
          return jsonToolResult({
            ok: false,
            action: "get_credential_schema",
            reason: "unauthorized",
            error: client.redact(err.message),
            hint: "GET /credentials/schema requires the API key to belong to an instance owner or admin.",
          });
        }
        throw err;
      }
    },
  };
}
