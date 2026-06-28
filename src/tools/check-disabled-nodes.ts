import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    activeOnly: Type.Optional(
      Type.Boolean({
        description:
          "Only scan active workflows. Default false — disabled nodes in inactive workflows are still drift signals.",
      }),
    ),
    includeArchived: Type.Optional(
      Type.Boolean({
        description: "Include archived workflows in the scan. Default false.",
      }),
    ),
    maxWorkflows: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 1000,
        description:
          "Cap on workflows INSPECTED (default 250). Counted after the active/archived filter, so when many archived workflows are skipped the scanner may page through more list rows than this number — but it will not fetch more than `maxWorkflows` full workflow definitions.",
      }),
    ),
    concurrency: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 8,
        description:
          "Parallel getWorkflow requests (default 3, max 8).",
      }),
    ),
  },
  { additionalProperties: false },
);

const PAGE_SIZE = 100;
const DEFAULT_MAX_WORKFLOWS = 250;
const DEFAULT_CONCURRENCY = 3;

export interface DisabledNodeFinding {
  workflowId: string;
  workflowName: string;
  active: boolean;
  archived: boolean;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
}

export interface CheckDisabledNodesOptions {
  activeOnly?: boolean;
  includeArchived?: boolean;
  maxWorkflows?: number;
  concurrency?: number;
}

export async function checkDisabledNodes(
  client: N8nClient,
  opts: CheckDisabledNodesOptions = {},
): Promise<Record<string, unknown>> {
  const activeOnly = opts.activeOnly === true;
  const includeArchived = opts.includeArchived === true;
  const maxWorkflows = opts.maxWorkflows ?? DEFAULT_MAX_WORKFLOWS;
  const concurrency = Math.max(
    1,
    Math.min(8, opts.concurrency ?? DEFAULT_CONCURRENCY),
  );

  {
      const summaries: Array<{ id: string; archived: boolean }> = [];
      let cursor: string | undefined;
      let truncated = false;
      while (summaries.length < maxWorkflows) {
        const remaining = maxWorkflows - summaries.length;
        const limit = Math.min(PAGE_SIZE, remaining);
        const page = await client.listWorkflows({
          active: activeOnly ? true : undefined,
          limit,
          cursor,
        });
        for (const w of page.data) {
          const archived = w.isArchived === true;
          if (archived && !includeArchived) continue;
          summaries.push({ id: String(w.id), archived });
          if (summaries.length >= maxWorkflows) break;
        }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (page.data.length === 0) break;
      }
      if (cursor) truncated = true;

      const definitions: N8nWorkflow[] = [];
      const fetchErrors: Array<{ workflowId: string; error: string }> = [];
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const i = nextIndex++;
          if (i >= summaries.length) return;
          const id = summaries[i].id;
          try {
            definitions.push(await client.getWorkflow(id));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            fetchErrors.push({ workflowId: id, error: client.redact(msg) });
          }
        }
      };
      const pool: Promise<void>[] = [];
      for (let i = 0; i < Math.min(concurrency, summaries.length); i++) {
        pool.push(worker());
      }
      await Promise.all(pool);

      const findings: DisabledNodeFinding[] = [];
      const perWorkflow = new Map<
        string,
        {
          workflowName: string;
          active: boolean;
          archived: boolean;
          disabledCount: number;
        }
      >();
      for (const wf of definitions) {
        if (!Array.isArray(wf.nodes)) continue;
        let wfDisabled = 0;
        for (const rawNode of wf.nodes) {
          if (!rawNode || typeof rawNode !== "object") continue;
          const n = rawNode as Record<string, unknown>;
          if (n.disabled !== true) continue;
          findings.push({
            workflowId: String(wf.id),
            workflowName: wf.name,
            active: wf.active,
            archived: wf.isArchived === true,
            nodeId: typeof n.id === "string" ? n.id : null,
            nodeName: typeof n.name === "string" ? n.name : "",
            nodeType: String(n.type ?? ""),
          });
          wfDisabled++;
        }
        if (wfDisabled > 0) {
          perWorkflow.set(String(wf.id), {
            workflowName: wf.name,
            active: wf.active,
            archived: wf.isArchived === true,
            disabledCount: wfDisabled,
          });
        }
      }

      const summary = Array.from(perWorkflow.entries())
        .map(([id, v]) => ({
          workflowId: id,
          workflowName: v.workflowName,
          active: v.active,
          archived: v.archived,
          disabledCount: v.disabledCount,
        }))
        .sort((a, b) => b.disabledCount - a.disabledCount);

      return {
        scannedWorkflows: definitions.length,
        requestedMaxWorkflows: maxWorkflows,
        truncated,
        fetchErrors,
        workflowsWithDisabled: summary.length,
        findingCount: findings.length,
        summary,
        findings,
      };
  }
}

export function createCheckDisabledNodesTool(getClient: () => N8nClient) {
  return {
    name: "n8n_check_disabled_nodes",
    label: "n8n: check disabled nodes",
    description:
      "Scan workflows and surface every node with `disabled: true`. One finding per (workflowId, nodeName, nodeType) plus a per-workflow count. Read-only. Disabled nodes are common drift signals — frozen mid-debug, forgotten cleanup — and the n8n UI doesn't surface them in any list view. Bounded-concurrency fan-out; per-workflow fetch errors land in `fetchErrors` instead of failing the scan.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await checkDisabledNodes(
          getClient(),
          rawParams as CheckDisabledNodesOptions,
        ),
      );
    },
  };
}
