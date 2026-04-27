import { describe, it, expect, vi } from "vitest";
import { createCheckDisabledNodesTool } from "../src/tools/check-disabled-nodes.ts";
import { makeFakeClient } from "./helpers.ts";
import type {
  N8nClient,
  N8nWorkflow,
  N8nWorkflowSummary,
} from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createCheckDisabledNodesTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createCheckDisabledNodesTool(() => client);
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

function workflow(
  id: string,
  nodes: Array<{ name: string; type: string; disabled?: boolean }>,
): N8nWorkflow {
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

describe("n8n_check_disabled_nodes", () => {
  it("emits findings for every disabled node and aggregates per-workflow", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("1"), summary("2")] });
    const getWorkflow = vi
      .fn()
      .mockResolvedValueOnce(
        workflow("1", [
          { name: "On", type: "n8n-nodes-base.set" },
          {
            name: "Off1",
            type: "n8n-nodes-base.httpRequest",
            disabled: true,
          },
          { name: "Off2", type: "n8n-nodes-base.code", disabled: true },
        ]),
      )
      .mockResolvedValueOnce(
        workflow("2", [{ name: "On", type: "n8n-nodes-base.set" }]),
      );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details).toMatchObject({
      scannedWorkflows: 2,
      findingCount: 2,
      workflowsWithDisabled: 1,
    });
    const summaryRows = details.summary as Array<Record<string, unknown>>;
    expect(summaryRows[0]).toMatchObject({
      workflowId: "1",
      disabledCount: 2,
    });
  });

  it("excludes archived workflows by default", async () => {
    const listWorkflows = vi.fn().mockResolvedValueOnce({
      data: [summary("1"), summary("2", true)],
    });
    const getWorkflow = vi.fn().mockResolvedValueOnce(
      workflow("1", [{ name: "Off", type: "x", disabled: true }]),
    );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, {});
    expect(details.scannedWorkflows).toBe(1);
  });

  it("captures per-workflow fetch errors without failing the scan", async () => {
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: [summary("1"), summary("2")] });
    const getWorkflow = vi
      .fn()
      .mockResolvedValueOnce(
        workflow("1", [{ name: "Off", type: "x", disabled: true }]),
      )
      .mockRejectedValueOnce(new Error("fetch failed for 2"));
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details.scannedWorkflows).toBe(1);
    expect(details.findingCount).toBe(1);
    const errs = details.fetchErrors as Array<Record<string, unknown>>;
    expect(errs).toHaveLength(1);
    expect(errs[0].workflowId).toBe("2");
  });
});
