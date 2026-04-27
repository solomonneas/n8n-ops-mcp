import { describe, it, expect, vi } from "vitest";
import { createFindWorkflowsUsingCredentialTool } from "../src/tools/find-workflows-using-credential.ts";
import { makeFakeClient } from "./helpers.ts";
import type {
  N8nClient,
  N8nWorkflow,
  N8nWorkflowSummary,
} from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createFindWorkflowsUsingCredentialTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createFindWorkflowsUsingCredentialTool(() => client);
}

function summary(id: string, archived = false): N8nWorkflowSummary {
  return {
    id,
    name: `Workflow ${id}`,
    active: true,
    isArchived: archived,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

interface NodeSpec {
  id?: string;
  name: string;
  type: string;
  credentials?: Record<string, { id: string; name: string }>;
}

function workflow(id: string, nodes: NodeSpec[]): N8nWorkflow {
  return {
    id,
    name: `Workflow ${id}`,
    active: true,
    isArchived: false,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    nodes,
    connections: {},
  };
}

describe("n8n_find_workflows_using_credential", () => {
  it("matches by exact credentialId across multiple node types", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("1"), summary("2")] });
    const getWorkflow = vi
      .fn()
      .mockResolvedValueOnce(
        workflow("1", [
          {
            name: "Slack 1",
            type: "n8n-nodes-base.slack",
            credentials: {
              slackApi: { id: "cred-1", name: "Slack OAuth" },
            },
          },
          {
            name: "Slack 2",
            type: "n8n-nodes-base.slack",
            credentials: {
              slackApi: { id: "cred-1", name: "Slack OAuth" },
            },
          },
          { name: "Set", type: "n8n-nodes-base.set" },
        ]),
      )
      .mockResolvedValueOnce(
        workflow("2", [
          {
            name: "GH",
            type: "n8n-nodes-base.github",
            credentials: {
              githubApi: { id: "cred-99", name: "GitHub" },
            },
          },
        ]),
      );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { credentialId: "cred-1" });

    expect(details).toMatchObject({
      scannedWorkflows: 2,
      findingCount: 2,
      workflowsWithMatches: 1,
    });
    const findings = details.findings as Array<Record<string, unknown>>;
    expect(findings[0]).toMatchObject({
      workflowId: "1",
      credentialId: "cred-1",
      credentialType: "slackApi",
    });
  });

  it("falls back to credentialName substring match when id is omitted", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("1")] });
    const getWorkflow = vi.fn().mockResolvedValueOnce(
      workflow("1", [
        {
          name: "Slack",
          type: "n8n-nodes-base.slack",
          credentials: {
            slackApi: { id: "x", name: "Production Slack OAuth" },
          },
        },
        {
          name: "Other",
          type: "n8n-nodes-base.set",
          credentials: {
            githubApi: { id: "y", name: "GitHub" },
          },
        },
      ]),
    );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { credentialName: "slack" });

    expect(details.findingCount).toBe(1);
    const target = details.target as Record<string, unknown>;
    expect(target).toMatchObject({ kind: "name", value: "slack" });
  });

  it("rejects when neither credentialId nor credentialName is provided", async () => {
    const listWorkflows = vi.fn();
    const getWorkflow = vi.fn();
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("missing_target");
    expect(listWorkflows).not.toHaveBeenCalled();
  });

  it("rejects when both credentialId and credentialName are provided (no silent prioritization)", async () => {
    const listWorkflows = vi.fn();
    const getWorkflow = vi.fn();
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, {
      credentialId: "cred-1",
      credentialName: "slack",
    });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("ambiguous_target");
    expect(listWorkflows).not.toHaveBeenCalled();
  });

  it("captures per-workflow fetch errors without failing the scan", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("1"), summary("2")] });
    const getWorkflow = vi
      .fn()
      .mockResolvedValueOnce(
        workflow("1", [
          {
            name: "Slack",
            type: "n8n-nodes-base.slack",
            credentials: { slackApi: { id: "cred-1", name: "Slack" } },
          },
        ]),
      )
      .mockRejectedValueOnce(new Error("fetch failed for 2"));
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { credentialId: "cred-1" });

    expect(details.scannedWorkflows).toBe(1);
    const errs = details.fetchErrors as Array<Record<string, unknown>>;
    expect(errs).toHaveLength(1);
    expect(errs[0].workflowId).toBe("2");
  });

  it("excludes archived workflows by default and includes them when requested", async () => {
    const listWorkflows = vi.fn().mockResolvedValueOnce({
      data: [summary("1"), summary("2", true)],
    });
    const getWorkflow = vi.fn().mockResolvedValueOnce(
      workflow("1", [
        {
          name: "Slack",
          type: "n8n-nodes-base.slack",
          credentials: { slackApi: { id: "cred-1", name: "Slack" } },
        },
      ]),
    );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { credentialId: "cred-1" });
    expect(details.scannedWorkflows).toBe(1);
  });

  it("aggregates per-workflow summary sorted by matchCount desc", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("a"), summary("b")] });
    const getWorkflow = vi
      .fn()
      .mockResolvedValueOnce(
        workflow("a", [
          {
            name: "S1",
            type: "n8n-nodes-base.slack",
            credentials: { slackApi: { id: "cred-1", name: "S" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        workflow("b", [
          {
            name: "S2",
            type: "n8n-nodes-base.slack",
            credentials: { slackApi: { id: "cred-1", name: "S" } },
          },
          {
            name: "S3",
            type: "n8n-nodes-base.slack",
            credentials: { slackApi: { id: "cred-1", name: "S" } },
          },
        ]),
      );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { credentialId: "cred-1" });

    const summaryRows = details.summary as Array<Record<string, unknown>>;
    expect(summaryRows[0]).toMatchObject({ workflowId: "b", matchCount: 2 });
    expect(summaryRows[1]).toMatchObject({ workflowId: "a", matchCount: 1 });
  });
});
