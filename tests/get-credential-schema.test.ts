import { describe, it, expect, vi } from "vitest";
import { createGetCredentialSchemaTool } from "../src/tools/get-credential-schema.ts";
import { makeFakeClient } from "./helpers.ts";
import { N8nApiError, type N8nClient } from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createGetCredentialSchemaTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createGetCredentialSchemaTool(() => client);
}

describe("n8n_get_credential_schema", () => {
  it("returns the raw JSON schema body and trims input", async () => {
    const schema = {
      additionalProperties: false,
      type: "object",
      properties: {
        apiKey: { type: "string" },
        domain: { type: "string" },
      },
      required: ["apiKey", "domain"],
    };
    const getCredentialSchema = vi.fn().mockResolvedValue(schema);
    const client = makeFakeClient({ getCredentialSchema });
    const tool = buildTool(client);

    const details = await run(tool, { credentialTypeName: "  freshdeskApi  " });

    expect(getCredentialSchema).toHaveBeenCalledWith("freshdeskApi");
    expect(details).toMatchObject({
      ok: true,
      credentialTypeName: "freshdeskApi",
      schema,
    });
  });

  it("returns reason=not_found on 404 with a hint", async () => {
    const getCredentialSchema = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(404, "/api/v1/credentials/schema/x", "not found"),
      );
    const client = makeFakeClient({ getCredentialSchema });
    const tool = buildTool(client);

    const details = await run(tool, { credentialTypeName: "bogusType" });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("not_found");
    expect(details.credentialTypeName).toBe("bogusType");
    expect(String(details.hint)).toMatch(/n8n_list_credentials/);
  });

  it("returns reason=unauthorized on 401", async () => {
    const getCredentialSchema = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(
          401,
          "/api/v1/credentials/schema/githubApi",
          "unauthorized",
        ),
      );
    const client = makeFakeClient({ getCredentialSchema });
    const tool = buildTool(client);

    const details = await run(tool, { credentialTypeName: "githubApi" });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("unauthorized");
  });

  it("rejects empty-after-trim type names defensively", async () => {
    const getCredentialSchema = vi.fn();
    const client = makeFakeClient({ getCredentialSchema });
    const tool = buildTool(client);

    const details = await run(tool, { credentialTypeName: "   " });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("empty_type_name");
    expect(getCredentialSchema).not.toHaveBeenCalled();
  });
});
