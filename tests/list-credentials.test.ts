import { describe, it, expect, vi } from "vitest";
import { createListCredentialsTool } from "../src/tools/list-credentials.ts";
import { makeFakeClient } from "./helpers.ts";
import {
  N8nApiError,
  type N8nClient,
  type N8nCredentialListItem,
} from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createListCredentialsTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createListCredentialsTool(() => client);
}

describe("n8n_list_credentials", () => {
  it("returns credentials with no `data` field and forwards pagination", async () => {
    const credentials: N8nCredentialListItem[] = [
      {
        id: "c1",
        name: "GitHub - solomonneas",
        type: "githubApi",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        shared: [],
      },
      {
        id: "c2",
        name: "Slack OAuth",
        type: "slackOAuth2Api",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        shared: [],
      },
    ];
    const listCredentials = vi
      .fn()
      .mockResolvedValue({ data: credentials, nextCursor: "next-page" });
    const client = makeFakeClient({ listCredentials });
    const tool = buildTool(client);

    const details = await run(tool, { limit: 50, cursor: "abc" });

    expect(listCredentials).toHaveBeenCalledWith({
      limit: 50,
      cursor: "abc",
    });
    expect(details).toMatchObject({
      count: 2,
      nextCursor: "next-page",
    });
    const data = details.data as Record<string, unknown>[];
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("c1");
    // Defensive: even if upstream regressed, no row should carry `data`.
    for (const row of data) {
      expect(row).not.toHaveProperty("data");
    }
  });

  it("strips a `data` field defensively if upstream regresses and echoes it", async () => {
    const listCredentials = vi.fn().mockResolvedValue({
      data: [
        {
          id: "c1",
          name: "leaky",
          type: "githubApi",
          // Simulating a future regression where n8n echoes `data` back.
          data: { token: "ghp_super_secret" },
        },
      ],
    });
    const client = makeFakeClient({ listCredentials });
    const tool = buildTool(client);

    const details = await run(tool, {});
    const data = details.data as Record<string, unknown>[];
    expect(data[0]).not.toHaveProperty("data");
    expect(JSON.stringify(details)).not.toContain("ghp_super_secret");
  });

  it("normalizes missing nextCursor to null", async () => {
    const listCredentials = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "c1", name: "x", type: "y" }] });
    const client = makeFakeClient({ listCredentials });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details.nextCursor).toBeNull();
  });

  it("surfaces 401 with an admin/owner hint", async () => {
    const listCredentials = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(401, "/api/v1/credentials", "unauthorized"),
      );
    const client = makeFakeClient({ listCredentials });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("unauthorized");
    expect(String(details.hint)).toMatch(/owner or admin/i);
  });

  it("rethrows non-401 API errors", async () => {
    const listCredentials = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(500, "/api/v1/credentials", "boom"),
      );
    const client = makeFakeClient({ listCredentials });
    const tool = buildTool(client);

    await expect(run(tool, {})).rejects.toThrow(/boom/);
  });
});
