import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nExecution } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        "Case-insensitive text to search for. Typical: an error fragment like 'ECONNREFUSED' or a node name.",
    }),
    workflowId: Type.Optional(
      Type.String({
        description: "Filter to a single workflow id. Omit to scan across all workflows.",
      }),
    ),
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("success"),
          Type.Literal("error"),
          Type.Literal("running"),
          Type.Literal("waiting"),
          Type.Literal("canceled"),
        ],
        {
          description:
            "Filter executions by status before searching. Default 'error' — matches the main use case ('which workflow errored with X?').",
        },
      ),
    ),
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("error"), Type.Literal("all")],
        {
          description:
            "'error' (default) searches only the execution error payload. 'all' additionally greps the full per-node run log — slower and returns more raw data.",
        },
      ),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 250,
        description: "Max executions to scan (default 50).",
      }),
    ),
    maxMatches: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Stop after this many matches (default 20).",
      }),
    ),
    snippetChars: Type.Optional(
      Type.Integer({
        minimum: 40,
        maximum: 600,
        description: "Context window around each match (default 160).",
      }),
    ),
  },
  { additionalProperties: false },
);

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_MATCHES = 20;
const DEFAULT_SNIPPET_CHARS = 160;

export interface SearchExecutionsOptions {
  query: string;
  workflowId?: string;
  status?: string;
  scope?: "error" | "all";
  limit?: number;
  maxMatches?: number;
  snippetChars?: number;
}

export async function searchExecutions(
  client: N8nClient,
  opts: SearchExecutionsOptions,
): Promise<Record<string, unknown>> {
  const query = opts.query;
  const needle = query.toLowerCase();
  const scope = opts.scope ?? "error";
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  const snippetChars = opts.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const status = opts.status ?? "error";

  const [executions, workflowIndex] = await Promise.all([
    client.listExecutions({
      workflowId: opts.workflowId,
      status,
      limit,
    }),
    loadWorkflowNames(client),
  ]);

  const matches: Array<Record<string, unknown>> = [];
  const skipped: Array<{ executionId: string; error: string }> = [];
  let scannedCount = 0;
  let truncated = false;

  for (const summary of executions.data) {
    scannedCount++;
    let detail: N8nExecution;
    try {
      detail = await client.getExecution(String(summary.id), {
        includeData: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({
        executionId: String(summary.id),
        error: client.redact(msg),
      });
      continue;
    }

    const hits = findHits(detail, needle, scope, snippetChars);
    if (hits.length === 0) continue;

    const workflowId = String(detail.workflowId ?? summary.workflowId ?? "");
    const errorMessage = extractErrorMessage(detail);
    matches.push({
      executionId: String(detail.id),
      workflowId,
      workflowName:
        detail.workflowData?.name ?? workflowIndex.get(workflowId) ?? null,
      status: detail.status ?? (detail.finished ? "success" : "running"),
      mode: detail.mode,
      startedAt: detail.startedAt ?? null,
      stoppedAt: detail.stoppedAt ?? null,
      errorMessage: errorMessage ? client.redact(errorMessage) : null,
      matchedIn: hits.map((h) => h.where),
      snippets: hits.map((h) => ({
        where: h.where,
        text: client.redact(h.snippet),
      })),
    });

    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
  }

  return {
    query,
    scope,
    status,
    scannedCount,
    matchCount: matches.length,
    skippedCount: skipped.length,
    truncated,
    matches,
    skipped,
    nextCursor: truncated ? null : executions.nextCursor ?? null,
  };
}

export function createSearchExecutionsTool(getClient: () => N8nClient) {
  return {
    name: "n8n_search_executions",
    label: "n8n: search executions",
    description:
      "Text-search recent n8n executions without paging through them one by one. Fetches each candidate with includeData=true, then greps the error payload (scope='error', default) or the full per-node run log (scope='all'). Returns matched executions with workflow context and a snippet around each hit. Snippets are raw run data with the API key redacted — with scope='all' they may still contain credentials or payload data from node outputs, so treat as sensitive.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as unknown as SearchExecutionsOptions;
      return jsonToolResult(await searchExecutions(getClient(), params));
    },
  };
}

interface Hit {
  where: string;
  snippet: string;
}

function findHits(
  detail: N8nExecution,
  needle: string,
  scope: "error" | "all",
  snippetChars: number,
): Hit[] {
  const hits: Hit[] = [];

  const error = detail.data?.resultData?.error;
  if (error !== undefined) {
    const errText = JSON.stringify(error);
    const idx = errText.toLowerCase().indexOf(needle);
    if (idx !== -1) {
      hits.push({
        where: "error",
        snippet: snippet(errText, idx, needle.length, snippetChars),
      });
    }
  }

  if (scope === "all") {
    const runData = detail.data?.resultData?.runData;
    if (runData && typeof runData === "object") {
      for (const [nodeName, nodeRuns] of Object.entries(runData)) {
        const text = JSON.stringify(nodeRuns);
        const idx = text.toLowerCase().indexOf(needle);
        if (idx !== -1) {
          hits.push({
            where: `node:${nodeName}`,
            snippet: snippet(text, idx, needle.length, snippetChars),
          });
        }
      }
    }
  }

  return hits;
}

function snippet(
  text: string,
  matchStart: number,
  matchLen: number,
  window: number,
): string {
  const half = Math.floor(window / 2);
  const start = Math.max(0, matchStart - half);
  const end = Math.min(text.length, matchStart + matchLen + half);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function extractErrorMessage(ex: N8nExecution): string | null {
  const err = ex.data?.resultData?.error as
    | { message?: unknown }
    | undefined;
  if (err && typeof err.message === "string") return err.message;
  return null;
}

async function loadWorkflowNames(
  client: N8nClient,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  try {
    const res = await client.listWorkflows({ limit: 250 });
    for (const w of res.data) {
      index.set(String(w.id), w.name);
    }
  } catch {
    // best-effort
  }
  return index;
}
