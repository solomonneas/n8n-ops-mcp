import { describe, it, expect, vi } from "vitest";
import { createDeleteCredentialTool } from "../src/tools/delete-credential.ts";
import { makeFakeClient } from "./helpers.ts";
import { N8nApiError, type N8nClient } from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createDeleteCredentialTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createDeleteCredentialTool(() => client);
}

describe("n8n_delete_credential", () => {
  it("deletes a credential and strips `data` from the echoed response", async () => {
    const deleteCredential = vi.fn().mockResolvedValue({
      id: "c1",
      name: "Slack",
      type: "slackApi",
      // Simulate upstream regression — must be stripped at tool layer.
      data: { clientSecret: "shhh" },
    });
    const client = makeFakeClient({ deleteCredential });
    const tool = buildTool(client);

    const details = await run(tool, { id: "c1", confirm: true });

    expect(details.ok).toBe(true);
    const deleted = details.deleted as Record<string, unknown>;
    expect(deleted).not.toHaveProperty("data");
    expect(JSON.stringify(details)).not.toContain("shhh");
    expect(deleteCredential).toHaveBeenCalledWith("c1");
  });

  it("refuses without confirm and surfaces the find-workflows-using-credential hint", async () => {
    const deleteCredential = vi.fn();
    const client = makeFakeClient({ deleteCredential });
    const tool = buildTool(client);

    const details = await run(tool, { id: "c1", confirm: false });

    expect(details.ok).toBe(false);
    expect(String(details.error)).toMatch(/confirm must be true/);
    expect(String(details.hint)).toMatch(/n8n_find_workflows_using_credential/);
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it("returns reason=not_found on 404", async () => {
    const deleteCredential = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(404, "/api/v1/credentials/missing", "not found"),
      );
    const client = makeFakeClient({ deleteCredential });
    const tool = buildTool(client);

    const details = await run(tool, { id: "missing", confirm: true });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("not_found");
    expect(details.id).toBe("missing");
  });

  it("returns reason=unauthorized on 401", async () => {
    const deleteCredential = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(401, "/api/v1/credentials/c1", "unauthorized"),
      );
    const client = makeFakeClient({ deleteCredential });
    const tool = buildTool(client);

    const details = await run(tool, { id: "c1", confirm: true });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("unauthorized");
  });

  it("rethrows non-404/401 API errors", async () => {
    const deleteCredential = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(500, "/api/v1/credentials/c1", "boom"),
      );
    const client = makeFakeClient({ deleteCredential });
    const tool = buildTool(client);

    await expect(run(tool, { id: "c1", confirm: true })).rejects.toThrow(
      /boom/,
    );
  });
});
