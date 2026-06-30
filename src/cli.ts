import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { N8nClient } from "./client.ts";
import { makeClient, type N8nPluginConfig } from "./config.ts";
import { serve } from "../mcp-server.ts";
import { validateWorkflow } from "./tools/validate-workflow.ts";
import { buildWorkflowDiff } from "./tools/diff-workflow.ts";
import { searchExecutions } from "./tools/search-executions.ts";
import { executionStats } from "./tools/execution-stats.ts";
import { listWebhooks } from "./tools/list-webhooks.ts";
import { listSchedules } from "./tools/list-schedules.ts";
import { checkDisabledNodes } from "./tools/check-disabled-nodes.ts";
import { findWorkflowsUsingNodeType } from "./tools/find-workflows-using-node-type.ts";
import { findWorkflowsUsingCredential } from "./tools/find-workflows-using-credential.ts";
import { auditBrowserBridgeUsage } from "./tools/audit-browser-bridge-usage.ts";
import { runAudit } from "./tools/run-audit.ts";

export const VERSION = "0.14.0";

export class UsageError extends Error {}

export type Parsed =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "mcp" }
  | { kind: "workflows-list"; json: boolean; active?: boolean; tags?: string; name?: string; limit?: number }
  | { kind: "workflows-get"; json: boolean; id: string; full: boolean }
  | { kind: "workflows-validate"; json: boolean; id: string }
  | { kind: "workflows-diff"; json: boolean; id: string; snapshotPath: string }
  | { kind: "executions-list"; json: boolean; status?: string; since?: number; workflowId?: string; limit?: number }
  | { kind: "executions-get"; json: boolean; id: string; runData: boolean }
  | { kind: "executions-search"; json: boolean; query: string; status?: string; scope?: "error" | "all"; limit?: number }
  | { kind: "executions-stats"; json: boolean; sinceHours?: number; workflowId?: string }
  | { kind: "webhooks-list"; json: boolean; activeOnly: boolean; limit?: number }
  | { kind: "schedules-list"; json: boolean; activeOnly: boolean; limit?: number }
  | { kind: "tags-list"; json: boolean; limit?: number }
  | { kind: "tags-workflow"; json: boolean; id: string }
  | { kind: "credentials-list"; json: boolean; limit?: number }
  | { kind: "credentials-schema"; json: boolean; type: string }
  | { kind: "credentials-find-usage"; json: boolean; credentialId: string }
  | { kind: "nodes-find"; json: boolean; nodeType: string; match: "exact" | "contains" }
  | { kind: "nodes-check-disabled"; json: boolean; activeOnly: boolean }
  | { kind: "audit-run"; json: boolean }
  | { kind: "audit-browser-bridge"; json: boolean; platform?: string; action?: string };

export const HELP = `n8nctrl - read-only n8n control CLI (alias: n8n-ops) over the n8n Public API

Usage:
  n8nctrl <group> <command> [options]

Commands:
  workflows list                 List workflows (--active, --tags, --name, --limit)
  workflows get <id>             Workflow metadata (--full for the node graph)
  workflows validate <id>        Static checks: deprecated nodes, orphans, missing trigger
  workflows diff <id> <path>     Diff a workflow against a JSON snapshot file
  executions list                List executions (--status, --since, --workflow, --limit)
  executions get <id>            One execution (--no-run-data for status+error only)
  executions search <query>      Text-search recent executions (--status, --scope, --limit)
  executions stats               Per-workflow failure rate + runtime (--since, --workflow)
  webhooks list                  Webhook + form-trigger paths (--all, --limit)
  schedules list                 Schedule triggers decoded to readable cadence (--all, --limit)
  tags list                      List tags (--limit)
  tags workflow <id>             Tags on a workflow
  credentials list               List credentials (--limit)
  credentials schema <type>      Credential type schema (e.g. githubApi)
  credentials find-usage <id>    Workflows referencing a credential id
  nodes find <nodeType>          Workflows using a node type (--contains)
  nodes check-disabled           Disabled nodes across workflows (--active)
  audit run                      n8n built-in security audit (exit 1 if not ok)
  audit browser-bridge           Audit browser-bridge CLI invocations (--platform, --action)
  mcp                            Start the MCP server over stdio
  help                           Show this help

Global options:
  --json                         Emit raw JSON instead of human-readable text
  --version, -v                  Print version
  --help, -h                     Show help

Environment:
  N8N_BASE_URL                   n8n base URL (e.g. http://localhost:5678) [required]
  N8N_API_KEY                    n8n Public API key [required]
  N8N_API_KEY_ENV                Name of the env var holding the key (default N8N_API_KEY)
  N8N_REQUEST_TIMEOUT_MS         Per-request timeout (default 15000)`;

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function ensureNoExtra(args: string[]): void {
  if (args.length) throw new UsageError(`Unexpected arguments: ${args.join(" ")}`);
}

function requireValue(v: string | undefined, name: string): string {
  if (v === undefined || v.startsWith("--")) throw new UsageError(`${name} requires a value`);
  return v;
}

function requireInt(v: string | undefined, name: string, min: number, max: number): number {
  const n = Number(requireValue(v, name));
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function requireNum(v: string | undefined, name: string, min: number, max: number): number {
  const n = Number(requireValue(v, name));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`${name} must be a number in [${min}, ${max}]`);
  }
  return n;
}

function requireEnum<T extends string>(v: string | undefined, allowed: readonly T[], name: string): T {
  const s = requireValue(v, name);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return s as T;
}

// Pull `--name value` from args, returning the value or undefined and removing
// both tokens. Errors if the flag is present without a value.
function takeOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new UsageError(`${name} requires a value`);
  args.splice(i, 2);
  return v;
}

function takeIntOption(args: string[], name: string, min: number, max: number): number | undefined {
  const raw = takeOption(args, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function takeNumOption(args: string[], name: string, min: number, max: number): number | undefined {
  const raw = takeOption(args, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`${name} must be a number in [${min}, ${max}]`);
  }
  return n;
}

function parseWorkflows(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "list": {
      let active: boolean | undefined;
      if (takeFlag(args, "--active")) active = true;
      else if (takeFlag(args, "--inactive")) active = false;
      const tags = takeOption(args, "--tags");
      const name = takeOption(args, "--name");
      const limit = takeIntOption(args, "--limit", 1, 250);
      ensureNoExtra(args);
      return { kind: "workflows-list", json, active, tags, name, limit };
    }
    case "get": {
      const full = takeFlag(args, "--full");
      const id = requireValue(args.shift(), "workflows get <id>");
      ensureNoExtra(args);
      return { kind: "workflows-get", json, id, full };
    }
    case "validate": {
      const id = requireValue(args.shift(), "workflows validate <id>");
      ensureNoExtra(args);
      return { kind: "workflows-validate", json, id };
    }
    case "diff": {
      const id = requireValue(args.shift(), "workflows diff <id> <snapshot-path>");
      const snapshotPath = requireValue(args.shift(), "workflows diff <id> <snapshot-path>");
      ensureNoExtra(args);
      return { kind: "workflows-diff", json, id, snapshotPath };
    }
    default:
      throw new UsageError(`Unknown workflows command: ${sub ?? "(none)"}`);
  }
}

function parseExecutions(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "list": {
      const status = takeOption(args, "--status");
      const since = takeNumOption(args, "--since", 0.25, 168);
      const workflowId = takeOption(args, "--workflow");
      const limit = takeIntOption(args, "--limit", 1, 250);
      ensureNoExtra(args);
      return { kind: "executions-list", json, status, since, workflowId, limit };
    }
    case "get": {
      const runData = !takeFlag(args, "--no-run-data");
      const id = requireValue(args.shift(), "executions get <id>");
      ensureNoExtra(args);
      return { kind: "executions-get", json, id, runData };
    }
    case "search": {
      const status = takeOption(args, "--status");
      const scope = takeOption(args, "--scope") as "error" | "all" | undefined;
      if (scope !== undefined && scope !== "error" && scope !== "all") {
        throw new UsageError("--scope must be one of: error, all");
      }
      const limit = takeIntOption(args, "--limit", 1, 250);
      const query = args.join(" ").trim();
      if (!query) throw new UsageError("executions search requires a query");
      return { kind: "executions-search", json, query, status, scope, limit };
    }
    case "stats": {
      const sinceHours = takeNumOption(args, "--since", 0.25, 168);
      const workflowId = takeOption(args, "--workflow");
      ensureNoExtra(args);
      return { kind: "executions-stats", json, sinceHours, workflowId };
    }
    default:
      throw new UsageError(`Unknown executions command: ${sub ?? "(none)"}`);
  }
}

function parseTags(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "list": {
      const limit = takeIntOption(args, "--limit", 1, 250);
      ensureNoExtra(args);
      return { kind: "tags-list", json, limit };
    }
    case "workflow": {
      const id = requireValue(args.shift(), "tags workflow <id>");
      ensureNoExtra(args);
      return { kind: "tags-workflow", json, id };
    }
    default:
      throw new UsageError(`Unknown tags command: ${sub ?? "(none)"}`);
  }
}

function parseCredentials(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "list": {
      const limit = takeIntOption(args, "--limit", 1, 250);
      ensureNoExtra(args);
      return { kind: "credentials-list", json, limit };
    }
    case "schema": {
      const type = requireValue(args.shift(), "credentials schema <type>");
      ensureNoExtra(args);
      return { kind: "credentials-schema", json, type };
    }
    case "find-usage": {
      const credentialId = requireValue(args.shift(), "credentials find-usage <credentialId>");
      ensureNoExtra(args);
      return { kind: "credentials-find-usage", json, credentialId };
    }
    default:
      throw new UsageError(`Unknown credentials command: ${sub ?? "(none)"}`);
  }
}

function parseNodes(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "find": {
      const match = takeFlag(args, "--contains") ? "contains" : "exact";
      const nodeType = requireValue(args.shift(), "nodes find <nodeType>");
      ensureNoExtra(args);
      return { kind: "nodes-find", json, nodeType, match };
    }
    case "check-disabled": {
      const activeOnly = takeFlag(args, "--active");
      ensureNoExtra(args);
      return { kind: "nodes-check-disabled", json, activeOnly };
    }
    default:
      throw new UsageError(`Unknown nodes command: ${sub ?? "(none)"}`);
  }
}

function parseAudit(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  switch (sub) {
    case "run": {
      ensureNoExtra(args);
      return { kind: "audit-run", json };
    }
    case "browser-bridge": {
      const platform = takeOption(args, "--platform");
      const action = takeOption(args, "--action");
      ensureNoExtra(args);
      return { kind: "audit-browser-bridge", json, platform, action };
    }
    default:
      throw new UsageError(`Unknown audit command: ${sub ?? "(none)"}`);
  }
}

function parseWebhooks(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub !== "list") throw new UsageError(`Unknown webhooks command: ${sub ?? "(none)"}`);
  const activeOnly = !takeFlag(args, "--all");
  const limit = takeIntOption(args, "--limit", 1, 100);
  ensureNoExtra(args);
  return { kind: "webhooks-list", json, activeOnly, limit };
}

function parseSchedules(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub !== "list") throw new UsageError(`Unknown schedules command: ${sub ?? "(none)"}`);
  const activeOnly = !takeFlag(args, "--all");
  const limit = takeIntOption(args, "--limit", 1, 250);
  ensureNoExtra(args);
  return { kind: "schedules-list", json, activeOnly, limit };
}

export function parseArgs(argv: string[]): Parsed {
  const args = [...argv];
  if (args.includes("-h") || args.includes("--help")) return { kind: "help" };
  if (args.includes("-v") || args.includes("--version")) return { kind: "version" };

  const group = args.shift();
  if (!group || group === "help") return { kind: "help" };
  if (group === "mcp") {
    ensureNoExtra(args);
    return { kind: "mcp" };
  }

  const json = takeFlag(args, "--json");
  switch (group) {
    case "workflows":
      return parseWorkflows(args, json);
    case "executions":
      return parseExecutions(args, json);
    case "webhooks":
      return parseWebhooks(args, json);
    case "schedules":
      return parseSchedules(args, json);
    case "tags":
      return parseTags(args, json);
    case "credentials":
      return parseCredentials(args, json);
    case "nodes":
      return parseNodes(args, json);
    case "audit":
      return parseAudit(args, json);
    default:
      throw new UsageError(`Unknown command group: ${group}`);
  }
}

// -------------------------------------------------------------------------
// Renderers (human-readable text). --json bypasses these entirely.
// -------------------------------------------------------------------------

// Structural view of the client's typed list responses. The client returns
// e.g. N8nWorkflowSummary[] which lacks an index signature; render via this
// loose row shape since renderers only read a handful of known fields.
type ListView = { data: Array<Record<string, unknown>>; nextCursor?: string };
function asListView(res: { data: ReadonlyArray<unknown>; nextCursor?: string }): ListView {
  return res as unknown as ListView;
}

function renderWorkflowsList(res: ListView): string {
  if (!res.data.length) return "No workflows.";
  const lines = [`${res.data.length} workflow(s):`];
  for (const w of res.data) {
    const flags = [w.active ? "active" : "inactive"];
    if (w.isArchived) flags.push("archived");
    const tags = Array.isArray(w.tags) ? (w.tags as Array<{ name?: string }>).map((t) => t.name).filter(Boolean) : [];
    const tagStr = tags.length ? `  [${tags.join(", ")}]` : "";
    lines.push(`  ${String(w.id).padEnd(8)} ${flags.join(",").padEnd(17)} ${String(w.name ?? "")}${tagStr}`);
  }
  if (res.nextCursor) lines.push(`  ... more (nextCursor=${res.nextCursor})`);
  return lines.join("\n");
}

function renderWorkflowGet(w: Record<string, unknown>, full: boolean): string {
  const nodes = Array.isArray(w.nodes) ? (w.nodes as unknown[]) : [];
  const lines = [
    `id:        ${w.id}`,
    `name:      ${w.name}`,
    `active:    ${w.active}`,
    `archived:  ${w.isArchived === true}`,
    `nodes:     ${nodes.length}`,
    `versionId: ${w.versionId ?? "(none)"}`,
    `updatedAt: ${w.updatedAt ?? "(unknown)"}`,
  ];
  const tags = Array.isArray(w.tags) ? (w.tags as Array<{ name?: string }>).map((t) => t.name).filter(Boolean) : [];
  if (tags.length) lines.push(`tags:      ${tags.join(", ")}`);
  if (full) {
    lines.push("nodeTypes:");
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      if (n && typeof n === "object" && "type" in n) {
        const t = String((n as { type: unknown }).type);
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${t}: ${c}`);
    }
  }
  return lines.join("\n");
}

function renderValidate(r: ReturnType<typeof validateWorkflow>, meta: { name: string }): string {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const i of r) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else info++;
  }
  const lines = [`${meta.name}: ${errors} error(s), ${warnings} warning(s), ${info} info`];
  for (const i of r) {
    const where = i.nodeName ? `  (${i.nodeName})` : "";
    lines.push(`  [${i.severity}] ${i.code}: ${i.message}${where}`);
  }
  if (!r.length) lines.push("  no issues");
  return lines.join("\n");
}

function renderDiff(d: ReturnType<typeof buildWorkflowDiff>): string {
  if (d.identical) return "Identical: no differences.";
  const s = d.summary;
  const lines = [
    `Differences:`,
    `  nodes +${s.nodesAdded} -${s.nodesRemoved} ~${s.nodesModified}`,
    `  name changed:        ${s.nameChanged}`,
    `  connections changed: ${s.connectionsChanged}`,
    `  settings changed:    ${s.settingsChanged}`,
  ];
  for (const n of d.diff.nodesAdded) lines.push(`  + ${n.name} [${n.type}]`);
  for (const n of d.diff.nodesRemoved) lines.push(`  - ${n.name} [${n.type}]`);
  for (const n of d.diff.nodesModified) lines.push(`  ~ ${n.name} [${n.type}] ${n.fieldsChanged.join(", ")}`);
  if (d.diff.nodesModifiedTruncated) lines.push("  ... (modified list truncated)");
  return lines.join("\n");
}

function renderExecutionsList(res: ListView): string {
  if (!res.data.length) return "No executions.";
  const lines = [`${res.data.length} execution(s):`];
  for (const e of res.data) {
    const status = e.status ?? (e.finished ? "success" : "running");
    lines.push(`  ${String(e.id).padEnd(8)} ${String(status).padEnd(9)} wf=${String(e.workflowId ?? "").padEnd(8)} ${e.startedAt ?? ""}`);
  }
  if (res.nextCursor) lines.push(`  ... more (nextCursor=${res.nextCursor})`);
  return lines.join("\n");
}

function renderExecutionGet(e: Record<string, unknown>): string {
  const status = e.status ?? (e.finished ? "success" : "running");
  const lines = [
    `id:         ${e.id}`,
    `workflowId: ${e.workflowId ?? ""}`,
    `status:     ${status}`,
    `mode:       ${e.mode ?? ""}`,
    `startedAt:  ${e.startedAt ?? ""}`,
    `stoppedAt:  ${e.stoppedAt ?? ""}`,
  ];
  const data = e.data as { resultData?: { error?: unknown; lastNodeExecuted?: string } } | undefined;
  const err = data?.resultData?.error;
  if (err !== undefined) {
    const msg = (err as { message?: unknown })?.message;
    lines.push(`error:      ${typeof msg === "string" ? msg : JSON.stringify(err)}`);
  }
  if (data?.resultData?.lastNodeExecuted) {
    lines.push(`lastNode:   ${data.resultData.lastNodeExecuted}`);
  }
  return lines.join("\n");
}

function renderSearch(d: Record<string, unknown>): string {
  const matches = (d.matches as Array<Record<string, unknown>>) ?? [];
  const lines = [
    `query "${d.query}" (scope=${d.scope}, status=${d.status}): ${d.matchCount} match(es) of ${d.scannedCount} scanned`,
  ];
  for (const m of matches) {
    lines.push(`  ${m.executionId}  ${m.status}  wf=${m.workflowId} ${m.workflowName ?? ""}`);
    if (m.errorMessage) lines.push(`    error: ${m.errorMessage}`);
    const snippets = (m.snippets as Array<{ where: string; text: string }>) ?? [];
    for (const s of snippets) lines.push(`    [${s.where}] ${s.text}`);
  }
  if (d.truncated) lines.push("  ... (truncated, raise --limit)");
  return lines.join("\n");
}

function renderStats(d: Record<string, unknown>): string {
  const totals = d.totals as Record<string, number>;
  const per = (d.perWorkflow as Array<Record<string, unknown>>) ?? [];
  const lines = [
    `window: ${d.windowHours}h  scanned=${d.scannedExecutions}  stopped=${d.stoppedReason}${d.truncated ? " (truncated)" : ""}`,
    `totals: total=${totals.total} success=${totals.success} error=${totals.error} canceled=${totals.canceled} running=${totals.running} failureRate=${totals.failureRate}`,
  ];
  for (const w of per) {
    lines.push(
      `  ${String(w.workflowId).padEnd(8)} ${String(w.workflowName ?? "").padEnd(24)} total=${w.total} err=${w.error} fail=${w.failureRate} p95=${w.p95RuntimeMs ?? "-"}ms`,
    );
  }
  return lines.join("\n");
}

function renderWebhooks(d: Record<string, unknown>): string {
  const hooks = (d.webhooks as Array<Record<string, unknown>>) ?? [];
  if (!hooks.length) return `No webhooks (scanned ${d.scannedWorkflows} workflow(s), activeOnly=${d.activeOnly}).`;
  const lines = [`${d.count} webhook(s) across ${d.scannedWorkflows} workflow(s):`];
  for (const h of hooks) {
    lines.push(`  ${String(h.method).padEnd(6)} ${h.triggerUrl}`);
    lines.push(`         wf=${h.workflowId} ${h.workflowName ?? ""}  node="${h.nodeName}"`);
  }
  return lines.join("\n");
}

function renderSchedules(d: Record<string, unknown>): string {
  const sched = (d.schedules as Array<Record<string, unknown>>) ?? [];
  if (!sched.length) return `No schedules (scanned ${d.scannedWorkflows} workflow(s), activeOnly=${d.activeOnly}).`;
  const lines = [`${d.count} schedule(s) across ${d.scannedWorkflows} workflow(s):`];
  for (const s of sched) {
    lines.push(`  ${String(s.schedule)}`);
    lines.push(`         wf=${s.workflowId} ${s.workflowName ?? ""}  node="${s.nodeName}"`);
  }
  return lines.join("\n");
}

function renderTagsList(res: ListView): string {
  if (!res.data.length) return "No tags.";
  const lines = [`${res.data.length} tag(s):`];
  for (const t of res.data) lines.push(`  ${String(t.id).padEnd(10)} ${t.name}`);
  if (res.nextCursor) lines.push(`  ... more (nextCursor=${res.nextCursor})`);
  return lines.join("\n");
}

function renderWorkflowTags(tags: Array<Record<string, unknown>>): string {
  if (!tags.length) return "No tags on this workflow.";
  return tags.map((t) => `  ${String(t.id).padEnd(10)} ${t.name}`).join("\n");
}

function renderCredentialsList(res: ListView): string {
  if (!res.data.length) return "No credentials.";
  const lines = [`${res.data.length} credential(s):`];
  for (const c of res.data) lines.push(`  ${String(c.id).padEnd(10)} ${String(c.type ?? "").padEnd(24)} ${c.name}`);
  if (res.nextCursor) lines.push(`  ... more (nextCursor=${res.nextCursor})`);
  return lines.join("\n");
}

function renderFindUsage(d: Record<string, unknown>, label: string): string {
  const findings = (d.findings as Array<Record<string, unknown>>) ?? [];
  const lines = [`${label}: ${d.findingCount} finding(s) in ${d.workflowsWithMatches} workflow(s) (scanned ${d.scannedWorkflows})`];
  for (const f of findings) {
    lines.push(`  wf=${f.workflowId} ${f.workflowName ?? ""}  node="${f.nodeName}" [${f.nodeType}]`);
  }
  if (d.truncated) lines.push("  ... (truncated, raise scan cap)");
  return lines.join("\n");
}

function renderCheckDisabled(d: Record<string, unknown>): string {
  const findings = (d.findings as Array<Record<string, unknown>>) ?? [];
  const lines = [`${d.findingCount} disabled node(s) in ${d.workflowsWithDisabled} workflow(s) (scanned ${d.scannedWorkflows})`];
  for (const f of findings) {
    lines.push(`  wf=${f.workflowId} ${f.workflowName ?? ""}  node="${f.nodeName}" [${f.nodeType}]`);
  }
  if (d.truncated) lines.push("  ... (truncated, raise scan cap)");
  return lines.join("\n");
}

function renderAuditRun(d: Record<string, unknown>): string {
  const reports = (d.reports as Array<Record<string, unknown>>) ?? [];
  const lines = [`audit: ${d.reportCount} report(s), ${d.totalSections} section(s), ${d.totalLocations} location(s)`];
  for (const r of reports) {
    lines.push(`  ${String(r.key).padEnd(14)} risk=${r.risk ?? "?"}  sections=${r.sectionCount}  locations=${r.locationCount}`);
  }
  if (!reports.length) lines.push("  no findings");
  return lines.join("\n");
}

function renderBrowserBridge(d: Record<string, unknown>): string {
  const findings = (d.findings as Array<Record<string, unknown>>) ?? [];
  const lines = [`browser-bridge: ${d.findingCount} invocation(s) (scanned ${d.scannedWorkflows} workflow(s))`];
  for (const f of findings) {
    lines.push(`  ${f.platform}/${f.action}  wf=${f.workflowId} ${f.workflowName ?? ""}  node="${f.nodeName}" [${f.source}]`);
  }
  if (d.truncated) lines.push("  ... (truncated, raise scan cap)");
  return lines.join("\n");
}

// -------------------------------------------------------------------------
// Config + client
// -------------------------------------------------------------------------

export function readConfigFromEnv(): N8nPluginConfig {
  const baseUrl = (process.env.N8N_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("N8N_BASE_URL is required (e.g. http://localhost:5678). Set it in your shell or .env.");
  }
  const apiKeyEnv = (process.env.N8N_API_KEY_ENV ?? "N8N_API_KEY").trim() || "N8N_API_KEY";
  const apiKey = (process.env[apiKeyEnv] ?? "").trim();
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is required. Generate an API key in n8n under Settings -> API.`);
  }
  const timeoutRaw = process.env.N8N_REQUEST_TIMEOUT_MS;
  let requestTimeoutMs = 15_000;
  if (timeoutRaw !== undefined && timeoutRaw.trim() !== "") {
    const n = Number(timeoutRaw);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1000) requestTimeoutMs = n;
  }
  return {
    baseUrl,
    apiKeyInline: apiKey,
    apiKeyEnv,
    enableEdit: false,
    enableCredentialsWrite: false,
    maxExecutionLogBytes: 65_536,
    requestTimeoutMs,
    backupDir: (process.env.N8N_BACKUP_DIR ?? "").trim() || undefined,
  };
}

export interface CliDeps {
  out: (s: string) => void;
  err: (s: string) => void;
  makeClient: () => N8nClient;
  getBaseUrl: () => string;
  serve: () => Promise<void>;
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    deps.err("");
    deps.err(HELP);
    return 2;
  }

  if (parsed.kind === "help") {
    deps.out(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    deps.out(VERSION);
    return 0;
  }
  if (parsed.kind === "mcp") {
    await deps.serve();
    return 0;
  }

  const client = deps.makeClient();
  const print = (human: () => string, raw: unknown): void => {
    deps.out(parsed.json ? JSON.stringify(raw, null, 2) : human());
  };

  try {
    switch (parsed.kind) {
      case "workflows-list": {
        const res = await client.listWorkflows({
          active: parsed.active,
          tags: parsed.tags,
          name: parsed.name,
          limit: parsed.limit,
        });
        print(() => renderWorkflowsList(asListView(res)), res);
        return 0;
      }
      case "workflows-get": {
        const wf = await client.getWorkflow(parsed.id);
        print(() => renderWorkflowGet(wf as unknown as Record<string, unknown>, parsed.full), wf);
        return 0;
      }
      case "workflows-validate": {
        const wf = await client.getWorkflow(parsed.id);
        const issues = validateWorkflow(wf);
        print(() => renderValidate(issues, { name: wf.name }), {
          workflowId: wf.id,
          workflowName: wf.name,
          issues,
        });
        return 0;
      }
      case "workflows-diff": {
        const snapshotRaw = await readSnapshot(parsed.snapshotPath);
        const current = await client.getWorkflow(parsed.id);
        const diff = buildWorkflowDiff(snapshotRaw, {
          name: current.name,
          nodes: current.nodes,
          connections: current.connections,
          settings: current.settings ?? {},
        });
        print(() => renderDiff(diff), { workflowId: current.id, ...diff });
        return 0;
      }
      case "executions-list": {
        const res = await client.listExecutions({
          status: parsed.status,
          workflowId: parsed.workflowId,
          limit: parsed.limit,
        });
        // --since is a client-side post-filter on startedAt because the n8n
        // Public API has no date filter on /executions.
        const filtered = parsed.since !== undefined
          ? { ...res, data: filterSince(res.data, parsed.since) }
          : res;
        print(() => renderExecutionsList(asListView(filtered)), filtered);
        return 0;
      }
      case "executions-get": {
        const ex = await client.getExecution(parsed.id, { includeData: parsed.runData });
        print(() => renderExecutionGet(ex as unknown as Record<string, unknown>), ex);
        return 0;
      }
      case "executions-search": {
        const d = await searchExecutions(client, {
          query: parsed.query,
          status: parsed.status,
          scope: parsed.scope,
          limit: parsed.limit,
        });
        print(() => renderSearch(d), d);
        return 0;
      }
      case "executions-stats": {
        const d = await executionStats(client, {
          sinceHours: parsed.sinceHours,
          workflowId: parsed.workflowId,
        });
        print(() => renderStats(d), d);
        return 0;
      }
      case "webhooks-list": {
        const d = await listWebhooks(client, deps.getBaseUrl(), {
          activeOnly: parsed.activeOnly,
          limit: parsed.limit,
        });
        print(() => renderWebhooks(d), d);
        return 0;
      }
      case "schedules-list": {
        const d = await listSchedules(client, {
          activeOnly: parsed.activeOnly,
          limit: parsed.limit,
        });
        print(() => renderSchedules(d), d);
        return 0;
      }
      case "tags-list": {
        const res = await client.listTags({ limit: parsed.limit });
        print(() => renderTagsList(asListView(res)), res);
        return 0;
      }
      case "tags-workflow": {
        const tags = await client.getWorkflowTags(parsed.id);
        print(() => renderWorkflowTags(tags as unknown as Array<Record<string, unknown>>), tags);
        return 0;
      }
      case "credentials-list": {
        const res = await client.listCredentials({ limit: parsed.limit });
        print(() => renderCredentialsList(asListView(res)), res);
        return 0;
      }
      case "credentials-schema": {
        const schema = await client.getCredentialSchema(parsed.type);
        print(() => JSON.stringify(schema, null, 2), schema);
        return 0;
      }
      case "credentials-find-usage": {
        const d = await findWorkflowsUsingCredential(client, { credentialId: parsed.credentialId });
        print(() => renderFindUsage(d, `credential ${parsed.credentialId}`), d);
        return 0;
      }
      case "nodes-find": {
        const d = await findWorkflowsUsingNodeType(client, {
          nodeType: parsed.nodeType,
          match: parsed.match,
        });
        print(() => renderFindUsage(d, `node ${parsed.nodeType} (${parsed.match})`), d);
        return 0;
      }
      case "nodes-check-disabled": {
        const d = await checkDisabledNodes(client, { activeOnly: parsed.activeOnly });
        print(() => renderCheckDisabled(d), d);
        return 0;
      }
      case "audit-run": {
        const d = await runAudit(client, {});
        print(() => renderAuditRun(d), d);
        return d.ok === true ? 0 : 1;
      }
      case "audit-browser-bridge": {
        const d = await auditBrowserBridgeUsage(client, {
          platform: parsed.platform,
          action: parsed.action,
        });
        print(() => renderBrowserBridge(d), d);
        return 0;
      }
    }
  } catch (error) {
    deps.err(client.redact(error instanceof Error ? error.message : String(error)));
    return 1;
  }
  return 0;
}

function filterSince(
  data: Array<{ startedAt?: string; stoppedAt?: string; createdAt?: string }>,
  sinceHours: number,
): typeof data {
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  return data.filter((e) => {
    const ts = e.startedAt ?? e.stoppedAt ?? e.createdAt;
    if (!ts) return true;
    const t = Date.parse(ts);
    return !Number.isFinite(t) || t >= cutoff;
  });
}

async function readSnapshot(path: string): Promise<Record<string, unknown>> {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`snapshot file must contain a JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

// True when this module is the process entrypoint. process.argv[1] is often a
// symlink (npm installs the bin as a link); resolve it before comparing.
const isEntrypoint = (() => {
  const arg = process.argv[1];
  if (typeof arg !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    makeClient: () => makeClient(readConfigFromEnv()),
    getBaseUrl: () => readConfigFromEnv().baseUrl,
    serve,
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
