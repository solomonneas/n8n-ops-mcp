import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    platform: Type.Optional(
      Type.String({
        description:
          "Filter findings to a single browser-bridge platform (e.g. 'coderlegion', 'substack', 'linktree').",
      }),
    ),
    action: Type.Optional(
      Type.String({
        description:
          "Filter findings to a single browser-bridge action (e.g. 'scan-comments', 'draft-post').",
      }),
    ),
    activeOnly: Type.Optional(
      Type.Boolean({
        description:
          "Only scan active workflows. Default false — archived/inactive workflows often hide stale browser-bridge calls worth surfacing.",
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
          "Cap on workflows fetched and inspected (default 250). Pagination keeps going until the cap or the cursor runs out.",
      }),
    ),
    concurrency: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 8,
        description:
          "Parallel getWorkflow requests when fetching definitions (default 3, max 8).",
      }),
    ),
  },
  { additionalProperties: false },
);

const PAGE_SIZE = 100;
const DEFAULT_MAX_WORKFLOWS = 250;
const DEFAULT_CONCURRENCY = 3;

const SCANNED_NODE_TYPES = new Set<string>([
  "n8n-nodes-base.executeCommand",
  "n8n-nodes-base.code",
  "n8n-nodes-base.function",
  "n8n-nodes-base.functionItem",
  "n8n-nodes-base.ssh",
]);

// Matches the *invocation* of the browser-bridge CLI script, captured per
// docs/n8n-usage.md: `node bin/browser-bridge.js <platform> <action>` (Execute
// Command heredoc) and `['bin/browser-bridge.js', '<platform>', '<action>']`
// (Code node spawn array). The `.js`/`.cjs`/`.mjs` extension is required to
// avoid matching directory mentions like `cd /opt/browser-bridge\nnode foo`,
// where the next two whitespace-separated words would otherwise be misread
// as platform+action. The bare `browser-bridge` bin form is intentionally
// not detected — n8n usage in our docs always goes through `node bin/…`.
// Captures: platform (group 1), action (group 2).
const BRIDGE_INVOCATION_RE =
  /\bbrowser-bridge\.[cm]?js(?:["'\]\s,]+|\s+)([a-z][a-z0-9-]*)(?:["'\]\s,]+|\s+)([a-z][a-z0-9-]*)/gi;

export interface Finding {
  workflowId: string;
  workflowName: string;
  active: boolean;
  archived: boolean;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
  /** Which parameter field the call came from — `command`, `jsCode`, `pythonCode`, etc. */
  source: string;
  platform: string;
  action: string;
}

export interface AuditBrowserBridgeUsageOptions {
  platform?: string;
  action?: string;
  activeOnly?: boolean;
  includeArchived?: boolean;
  maxWorkflows?: number;
  concurrency?: number;
}

export async function auditBrowserBridgeUsage(
  client: N8nClient,
  opts: AuditBrowserBridgeUsageOptions = {},
): Promise<Record<string, unknown>> {
  const platformFilter = opts.platform?.toLowerCase();
  const actionFilter = opts.action?.toLowerCase();
  const activeOnly = opts.activeOnly === true;
  const includeArchived = opts.includeArchived === true;
  const maxWorkflows = opts.maxWorkflows ?? DEFAULT_MAX_WORKFLOWS;
  const concurrency = Math.max(
    1,
    Math.min(8, opts.concurrency ?? DEFAULT_CONCURRENCY),
  );

  {
      // Page through summaries until cap or cursor exhausted.
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

      // Fan out getWorkflow calls with bounded concurrency.
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

      // Walk nodes and emit findings.
      const findings: Finding[] = [];
      for (const wf of definitions) {
        if (!Array.isArray(wf.nodes)) continue;
        for (const rawNode of wf.nodes) {
          for (const f of extractFindings(rawNode, wf)) {
            if (platformFilter && f.platform.toLowerCase() !== platformFilter) {
              continue;
            }
            if (actionFilter && f.action.toLowerCase() !== actionFilter) {
              continue;
            }
            findings.push(f);
          }
        }
      }

      // Aggregate platform x action counts so the agent can spot duplication
      // without re-scanning the findings array.
      const byPlatform = new Map<string, Map<string, number>>();
      for (const f of findings) {
        const inner = byPlatform.get(f.platform) ?? new Map<string, number>();
        inner.set(f.action, (inner.get(f.action) ?? 0) + 1);
        byPlatform.set(f.platform, inner);
      }
      const summary = Array.from(byPlatform.entries())
        .map(([platform, actions]) => ({
          platform,
          actions: Array.from(actions.entries())
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => a.platform.localeCompare(b.platform));

      return {
        scannedWorkflows: definitions.length,
        requestedMaxWorkflows: maxWorkflows,
        truncated,
        fetchErrors,
        findingCount: findings.length,
        findings,
        summary,
      };
  }
}

export function createAuditBrowserBridgeUsageTool(getClient: () => N8nClient) {
  return {
    name: "n8n_audit_browser_bridge_usage",
    label: "n8n: audit browser-bridge usage",
    description:
      "Scan every workflow for nodes that invoke the browser-bridge CLI (Execute Command, Code/Function, or SSH nodes). Returns one finding per (workflowId, nodeName, platform, action) so you can answer 'where am I calling Linktree sync from?' without grepping the n8n DB. Read-only. Heuristic: matches `browser-bridge[.js|.cjs] <platform> <action>` in command/jsCode strings, including spawn-array form.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await auditBrowserBridgeUsage(
          getClient(),
          rawParams as AuditBrowserBridgeUsageOptions,
        ),
      );
    },
  };
}

function extractFindings(rawNode: unknown, wf: N8nWorkflow): Finding[] {
  if (!rawNode || typeof rawNode !== "object") return [];
  const n = rawNode as Record<string, unknown>;
  const type = String(n.type ?? "");
  if (!SCANNED_NODE_TYPES.has(type)) return [];

  const name = typeof n.name === "string" ? n.name : "";
  const id = typeof n.id === "string" ? n.id : null;
  const params = (n.parameters as Record<string, unknown>) ?? {};

  // Field set varies by node type. Inspect every plausible string field
  // rather than special-casing per type — keeps the audit robust against
  // future n8n node-shape changes.
  const candidateFields = [
    "command", // executeCommand, ssh
    "jsCode", // code (javascript)
    "pythonCode", // code (python)
    "functionCode", // legacy function/functionItem
  ] as const;

  const findings: Finding[] = [];
  for (const field of candidateFields) {
    const value = params[field];
    if (typeof value !== "string" || value.length === 0) continue;
    for (const { platform, action } of scanInvocations(value)) {
      findings.push({
        workflowId: String(wf.id),
        workflowName: wf.name,
        active: wf.active,
        archived: wf.isArchived === true,
        nodeId: id,
        nodeName: name,
        nodeType: type,
        source: field,
        platform,
        action,
      });
    }
  }
  return findings;
}

function scanInvocations(text: string): Array<{ platform: string; action: string }> {
  const out: Array<{ platform: string; action: string }> = [];
  // Per-call clone of the regex — global RegExps are stateful and a shared
  // lastIndex would corrupt parallel scans.
  const re = new RegExp(BRIDGE_INVOCATION_RE.source, BRIDGE_INVOCATION_RE.flags);
  // De-dupe identical (platform, action) pairs within a single field — multiple
  // mentions in the same Code node should still emit one finding per pair.
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const platform = m[1];
    const action = m[2];
    const key = `${platform}::${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform, action });
  }
  return out;
}
