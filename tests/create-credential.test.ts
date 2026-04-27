import { describe, it, expect, vi } from "vitest";
import { createCreateCredentialTool } from "../src/tools/create-credential.ts";
import { makeFakeClient } from "./helpers.ts";
import { N8nApiError, type N8nClient } from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createCreateCredentialTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createCreateCredentialTool(() => client);
}

describe("n8n_create_credential", () => {
  it("creates a credential and never echoes `data` back, even if upstream regresses", async () => {
    const createCredential = vi.fn().mockResolvedValue({
      id: "c-new",
      name: "GH",
      type: "githubApi",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      // Simulate a future regression where n8n echoes `data` back.
      data: { token: "ghp_super_secret" },
    });
    const client = makeFakeClient({ createCredential });
    const tool = buildTool(client);

    const details = await run(tool, {
      name: "GH",
      type: "githubApi",
      data: { token: "ghp_super_secret" },
      confirm: true,
    });

    expect(details.ok).toBe(true);
    const credential = details.credential as Record<string, unknown>;
    expect(credential).not.toHaveProperty("data");
    expect(JSON.stringify(details)).not.toContain("ghp_super_secret");
    expect(createCredential).toHaveBeenCalledWith({
      name: "GH",
      type: "githubApi",
      data: { token: "ghp_super_secret" },
    });
  });

  it("refuses without confirm and does not call the API", async () => {
    const createCredential = vi.fn();
    const client = makeFakeClient({ createCredential });
    const tool = buildTool(client);

    const details = await run(tool, {
      name: "GH",
      type: "githubApi",
      data: { token: "x" },
      confirm: false,
    });

    expect(details.ok).toBe(false);
    expect(String(details.error)).toMatch(/confirm must be true/);
    expect(createCredential).not.toHaveBeenCalled();
  });

  it("redacts upstream 400 error bodies that may echo the secret", async () => {
    // The client.createCredential layer is responsible for stripping the
    // body before throwing. Simulate that by throwing a body-free
    // N8nApiError (which is what our client wraps). The tool layer must
    // also avoid surfacing any portion of the request body.
    const secretToken = "ghp_super_secret_should_not_leak";
    const createCredential = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(
          400,
          "/api/v1/credentials",
          "credential create failed (status 400)",
        ),
      );
    const client = makeFakeClient({ createCredential });
    const tool = buildTool(client);

    const details = await run(tool, {
      name: "GH",
      type: "githubApi",
      data: { token: secretToken },
      confirm: true,
    });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("bad_request");
    expect(details.status).toBe(400);
    expect(JSON.stringify(details)).not.toContain(secretToken);
    expect(String(details.error)).not.toMatch(secretToken);
  });

  it("surfaces 401 with admin/owner hint", async () => {
    const createCredential = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(
          401,
          "/api/v1/credentials",
          "credential create failed (status 401)",
        ),
      );
    const client = makeFakeClient({ createCredential });
    const tool = buildTool(client);

    const details = await run(tool, {
      name: "GH",
      type: "githubApi",
      data: { token: "x" },
      confirm: true,
    });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("unauthorized");
    expect(String(details.hint)).toMatch(/owner or admin/i);
  });

  it("rejects empty-after-trim name or type", async () => {
    const createCredential = vi.fn();
    const client = makeFakeClient({ createCredential });
    const tool = buildTool(client);

    const details = await run(tool, {
      name: "   ",
      type: "githubApi",
      data: { token: "x" },
      confirm: true,
    });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("empty_field");
    expect(createCredential).not.toHaveBeenCalled();
  });
});
