import { Type } from "@sinclair/typebox";
import type {
  N8nClient,
  N8nExecutionSummary,
  N8nWorkflowSummary,
} from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    workflowId: Type.Optional(
      Type.String({
        description:
          "Restrict stats to a single workflow id. Omit to compute per-workflow stats across the instance.",
      }),
    ),
    sinceHours: Type.Optional(
      Type.Number({
        minimum: 0.25,
        maximum: 168,
        description:
          "Window in hours to consider (default 24, max 168 = 7d). Executions whose `startedAt` is older than `now - sinceHours` are skipped. Capped at 7d because the n8n API has no native date filter — we paginate and stop early.",
      }),
    ),
    maxExecutions: Type.Optional(
      Type.Integer({
        minimum: 50,
        maximum: 5000,
        description:
          "Hard cap on executions fetched and inspected (default 1000). The tool stops paginating once this cap is hit OR when an execution older than the window is seen.",
      }),
    ),
    pageSize: Type.Optional(
      Type.Integer({
        minimum: 50,
        maximum: 250,
        description:
          "Page size for /executions (default 250). Lower values trade roundtrips for finer-grained early termination on the window boundary.",
      }),
    ),
  },
  { additionalProperties: false },
);

const DEFAULT_SINCE_HOURS = 24;
const DEFAULT_MAX_EXECUTIONS = 1000;
const DEFAULT_PAGE_SIZE = 250;

export interface PerWorkflowStats {
  workflowId: string;
  workflowName: string | null;
  total: number;
  success: number;
  error: number;
  canceled: number;
  running: number;
  waiting: number;
  other: number;
  failureRate: number;
  avgRuntimeMs: number | null;
  p95RuntimeMs: number | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}

export interface ExecutionStatsOptions {
  workflowId?: string;
  sinceHours?: number;
  maxExecutions?: number;
  pageSize?: number;
}

export async function executionStats(
  client: N8nClient,
  opts: ExecutionStatsOptions = {},
): Promise<Record<string, unknown>> {
  const sinceHours = opts.sinceHours ?? DEFAULT_SINCE_HOURS;
  const maxExecutions = opts.maxExecutions ?? DEFAULT_MAX_EXECUTIONS;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const cutoffMs = Date.now() - sinceHours * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const params = opts;
  {
      // Best-effort name lookup. Falls back to null on failure.
      const workflowNames = new Map<string, string>();
      try {
        const wfPage = await client.listWorkflows({ limit: 250 });
        for (const w of wfPage.data as N8nWorkflowSummary[]) {
          workflowNames.set(String(w.id), w.name);
        }
      } catch {
        // ignore
      }

      const collected: N8nExecutionSummary[] = [];
      let cursor: string | undefined;
      let truncated = false;
      let stoppedReason: "cap" | "window" | "exhausted" = "exhausted";
      // `inspected` bounds total work done — every row pulled from the API,
      // whether it survives the window filter or not. Without this, a stream
      // of mostly-old pages could quietly fetch thousands of rows before
      // finally reaching the window boundary, blowing past `maxExecutions`.
      let inspected = 0;
      while (inspected < maxExecutions) {
        const remaining = maxExecutions - inspected;
        const limit = Math.min(pageSize, remaining);
        const page = await client.listExecutions({
          workflowId: params.workflowId,
          limit,
          cursor,
        });
        // Filter the entire page on the in-window predicate. n8n's Public
        // API does not contractually guarantee newest-first sort order, so
        // a single old execution mid-page does NOT mean every later row in
        // the page is also old — scan all rows, then stop only when we get
        // a page where nothing was kept (whole page is past the window).
        let pageKept = 0;
        let pageOldSeen = 0;
        for (const ex of page.data) {
          inspected++;
          const startedAt = ex.startedAt ?? ex.stoppedAt ?? ex.createdAt;
          if (startedAt) {
            const t = Date.parse(startedAt);
            if (Number.isFinite(t) && t < cutoffMs) {
              pageOldSeen++;
              if (inspected >= maxExecutions) break;
              continue;
            }
          }
          collected.push(ex);
          pageKept++;
          if (inspected >= maxExecutions) break;
        }
        if (inspected >= maxExecutions) {
          stoppedReason = "cap";
          truncated = !!page.nextCursor;
          break;
        }
        // Whole page outside window AND we've already collected something
        // → safe to stop. If we kept nothing on the very first page (no
        // collected items yet), still stop — we've exhausted recent rows.
        if (pageOldSeen > 0 && pageKept === 0) {
          stoppedReason = "window";
          break;
        }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (page.data.length === 0) break;
      }

      const byWorkflow = new Map<string, PerWorkflowStats>();
      const runtimesByWf = new Map<string, number[]>();
      for (const ex of collected) {
        const wfId = String(ex.workflowId ?? "");
        if (!wfId) continue;
        let stats = byWorkflow.get(wfId);
        if (!stats) {
          stats = {
            workflowId: wfId,
            workflowName: workflowNames.get(wfId) ?? null,
            total: 0,
            success: 0,
            error: 0,
            canceled: 0,
            running: 0,
            waiting: 0,
            other: 0,
            failureRate: 0,
            avgRuntimeMs: null,
            p95RuntimeMs: null,
            lastFailureAt: null,
            lastSuccessAt: null,
          };
          byWorkflow.set(wfId, stats);
          runtimesByWf.set(wfId, []);
        }
        stats.total++;
        const status = String(
          ex.status ?? (ex.finished ? "success" : "running"),
        );
        switch (status) {
          case "success":
            stats.success++;
            break;
          case "error":
            stats.error++;
            break;
          case "canceled":
            stats.canceled++;
            break;
          case "running":
            stats.running++;
            break;
          case "waiting":
            stats.waiting++;
            break;
          default:
            stats.other++;
        }

        const start = ex.startedAt ? Date.parse(ex.startedAt) : NaN;
        const stop = ex.stoppedAt ? Date.parse(ex.stoppedAt) : NaN;
        if (Number.isFinite(start) && Number.isFinite(stop) && stop >= start) {
          runtimesByWf.get(wfId)!.push(stop - start);
        }

        if (status === "error" && ex.startedAt) {
          if (!stats.lastFailureAt || ex.startedAt > stats.lastFailureAt) {
            stats.lastFailureAt = ex.startedAt;
          }
        }
        if (status === "success" && ex.startedAt) {
          if (!stats.lastSuccessAt || ex.startedAt > stats.lastSuccessAt) {
            stats.lastSuccessAt = ex.startedAt;
          }
        }
      }

      // Finalize: failure rate (error / (success + error + canceled), excludes running/waiting),
      // avg + p95 runtime over completed executions with valid timestamps.
      for (const stats of byWorkflow.values()) {
        const completed = stats.success + stats.error + stats.canceled;
        stats.failureRate =
          completed > 0 ? round4(stats.error / completed) : 0;
        const runtimes = runtimesByWf.get(stats.workflowId) ?? [];
        if (runtimes.length > 0) {
          const sum = runtimes.reduce((a, b) => a + b, 0);
          stats.avgRuntimeMs = Math.round(sum / runtimes.length);
          const sorted = [...runtimes].sort((a, b) => a - b);
          const idx = Math.min(
            sorted.length - 1,
            Math.floor(sorted.length * 0.95),
          );
          stats.p95RuntimeMs = sorted[idx];
        }
      }

      const perWorkflow = Array.from(byWorkflow.values()).sort(
        (a, b) => b.total - a.total,
      );

      const totals = perWorkflow.reduce(
        (acc, s) => {
          acc.total += s.total;
          acc.success += s.success;
          acc.error += s.error;
          acc.canceled += s.canceled;
          acc.running += s.running;
          acc.waiting += s.waiting;
          acc.other += s.other;
          return acc;
        },
        {
          total: 0,
          success: 0,
          error: 0,
          canceled: 0,
          running: 0,
          waiting: 0,
          other: 0,
        },
      );
      const completed = totals.success + totals.error + totals.canceled;
      const overallFailureRate =
        completed > 0 ? round4(totals.error / completed) : 0;

      return {
        windowHours: sinceHours,
        windowSince: cutoff,
        windowUntil: new Date().toISOString(),
        scannedExecutions: collected.length,
        inspectedExecutions: inspected,
        truncated,
        stoppedReason,
        workflowCount: perWorkflow.length,
        totals: { ...totals, failureRate: overallFailureRate },
        perWorkflow,
      };
  }
}

export function createExecutionStatsTool(getClient: () => N8nClient) {
  return {
    name: "n8n_execution_stats",
    label: "n8n: execution stats",
    description:
      "Aggregate execution stats over a recent window. Computes per-workflow counts (total/success/error/canceled/running/waiting), failure rate, avg + p95 runtime, last failure + last success timestamps. Composed read-only — paginates /executions and stops on the window boundary or `maxExecutions`. Useful for 'which workflows are flaky?' and 'what's running long?'. Pagination is best-effort: if `truncated: true`, increase `maxExecutions` or narrow `sinceHours`.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await executionStats(getClient(), rawParams as ExecutionStatsOptions),
      );
    },
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
