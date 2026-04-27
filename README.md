# n8n-ops-mcp

[![npm version](https://img.shields.io/npm/v/n8n-ops-mcp.svg)](https://www.npmjs.com/package/n8n-ops-mcp)
[![license](https://img.shields.io/npm/l/n8n-ops-mcp.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

Ops-focused n8n tools for any MCP-compatible client. List, inspect, trigger, validate, manage tags, run security audits, and safely edit n8n workflows - with auto-backup and confirm gates on destructive writes.

Built for [OpenClaw](https://github.com/openclaw/openclaw) as a first-class plugin, exposed as an MCP server for everyone else. Works with Claude Desktop, Claude Code, Codex CLI, Hermes Agent, Cursor, Windsurf, or any other MCP host. No hard dependency on a specific model or agent harness.

## Why

Your agent has no native awareness of your n8n footprint. With this package, it can answer "what's broken in my n8n?", trigger workflows from chat, or clean up old executions without you leaving your client.

For a catalog/docs tool that indexes n8n's node library, see [n8n-mcp](https://www.npmjs.com/package/n8n-mcp). This one is ops-focused - list, trigger, validate, edit.

## Tools

| Tool | Purpose | Write |
|---|---|---|
| `n8n_list_workflows` | List workflows, filter by `active` / `tags` / `name` | |
| `n8n_get_workflow` | Fetch one workflow, optionally with full node graph | |
| `n8n_list_executions` | List recent executions, filter by workflow / status | |
| `n8n_get_execution` | Fetch an execution with per-node run log + raw error | |
| `n8n_search_executions` | Text-search recent executions for an error fragment | |
| `n8n_list_webhooks` | Enumerate webhook + form-trigger URLs | |
| `n8n_validate_workflow` | Static checks: deprecated nodes, legacy Code-node API, orphans | |
| `n8n_diff_workflow` | Compare a workflow against a snapshot file or inline object - semantic diff (added/removed/modified nodes with field paths) | |
| `n8n_list_schedules` | List every schedule trigger across workflows with human-readable descriptions ("daily at 03:00", "cron: 0 */6 * * *") | |
| `n8n_trigger` | Run a workflow via webhook (reliable) or workflow-id | |
| `n8n_audit_browser_bridge_usage` | Find every workflow that calls the [`browser-bridge`](https://github.com/solomonneas/browser-bridge) CLI (Execute Command, Code, SSH nodes) | |
| `n8n_scaffold_browser_bridge_node` | Generate a ready-to-paste n8n node that calls a `browser-bridge <platform> <action>` (no API call) | |
| `n8n_run_audit` | Run n8n's built-in security audit (credentials, database, nodes, filesystem, instance) | |
| `n8n_find_workflows_using_node_type` | Find every workflow using a given node type (e.g. `n8n-nodes-base.slack`), with `exact` or `contains` match | |
| `n8n_execution_stats` | Per-workflow stats over a recent window: counts, failure rate, avg + p95 runtime, last failure | |
| `n8n_list_tags` | List workflow tags with `id`, `name`, `createdAt`, `updatedAt` | |
| `n8n_get_workflow_tags` | Read the tags currently attached to a workflow | |
| `n8n_list_credentials` | List credentials (metadata only — secrets never echoed; admin/owner key required) | |
| `n8n_get_credential_schema` | Fetch the JSON schema for a credential type (e.g. `freshdeskApi`) | |
| `n8n_find_workflows_using_credential` | Find every workflow node that references a credential by `id` (preferred) or `name` substring; rotation/blast-radius scanner | |
| `n8n_check_disabled_nodes` | Scan workflows for `disabled: true` nodes — common drift signals not surfaced in the n8n UI | |
| `n8n_create_workflow` | Create a workflow (accepts `n8n_get_workflow` output directly; primary restore path) | ✓ |
| `n8n_activate` | Enable a workflow's triggers | ✓ |
| `n8n_deactivate` | Disable a workflow's triggers | ✓ |
| `n8n_save_workflow` | Overwrite a workflow with auto-backup + validation + confirm gate | ✓ |
| `n8n_archive_workflow` | Soft-delete a workflow (reversible; preserves id) | ✓ |
| `n8n_unarchive_workflow` | Restore an archived workflow (does NOT reactivate) | ✓ |
| `n8n_delete_workflow` | Permanently delete a workflow (confirm-gated, snapshot-before-delete, restore via `n8n_create_workflow`) | ✓ |
| `n8n_cancel_execution` | Stop a running or waiting execution by id | ✓ |
| `n8n_retry_execution` | Retry a failed execution by id (returns a new execution) | ✓ |
| `n8n_delete_execution` | Permanently delete an execution record (confirm-gated, irreversible) | ✓ |
| `n8n_delete_executions` | Batch form of delete (client-side fan-out, confirm-gated, irreversible, max 50 ids) | ✓ |
| `n8n_pin_node_data` | Pin sample data to a node so downstream nodes use it during testing (confirm-gated, replace-or-merge) | ✓ |
| `n8n_unpin_node_data` | Clear pinned data on one node or the whole workflow (confirm-gated, idempotent) | ✓ |
| `n8n_create_tag` | Create a workflow tag (no confirm; reversible via `n8n_delete_tag`) | ✓ |
| `n8n_delete_tag` | Permanently delete a tag (confirm-gated; cascades — removes the tag from every workflow) | ✓ |
| `n8n_set_workflow_tags` | Replace the tag set on a workflow (no confirm; reversible by re-setting) | ✓ |
| `n8n_retry_executions` | Batch retry executions (confirm-gated, max 50 ids, AbortController on 5xx) | ✓ |
| `n8n_create_credential` | Create a credential (confirm-gated; **double-gated** behind `enableCredentialsWrite`; tool layer redacts `data` from every response branch) | ✓✓ |
| `n8n_delete_credential` | Permanently delete a credential (confirm-gated; **double-gated**; cascades — every workflow referencing it will fail) | ✓✓ |

Write tools are hidden unless `N8N_ENABLE_EDIT=true`.

<details>
<summary><b>Detailed tool reference</b></summary>

**`n8n_list_workflows`** - filter by `active`, `tags`, `name` (substring), `limit`. Returns id, name, active state, tags, updatedAt.

**`n8n_get_workflow`** - fetch one by id. Returns metadata by default. Pass `includeDefinition: true` for the full node graph + connections.

**`n8n_list_executions`** - filter by `workflowId`, `status` (success/error/running/waiting/canceled), `limit`. Returns id, workflowId, workflowName, status, mode, startedAt, stoppedAt.

**`n8n_get_execution`** - includes per-node run log (truncated to `maxExecutionLogBytes`, default 64 KB) and the raw error object verbatim when status is `error`. Pass `includeRunData: false` to skip the run log.

**`n8n_search_executions`** - defaults to scanning `status=error` executions for a `query` fragment (e.g. `ECONNREFUSED`) and returning matches with workflow context + a snippet around each hit. `scope: "error"` (default) greps the error payload only; `scope: "all"` also greps full per-node run data (slower, may return node outputs - treat snippets as sensitive). Optional `workflowId`, `status`, `limit` (default 50, max 250), `maxMatches` (default 20), `snippetChars` (default 160). Returns `matches` plus a `skipped` array for any execution that failed to fetch.

**`n8n_list_webhooks`** - scans workflows for webhook and form-trigger nodes and returns their paths + fully-formed `triggerUrl`. Pairs with `n8n_trigger` mode='webhook'. Optional `workflowId`, `activeOnly` (default true), `limit` (default 50).

**`n8n_validate_workflow`** - checks for deprecated node types (function → code), legacy Code-node API (`$node[]`, `items` global, `require()`), orphan nodes, disabled nodes, missing trigger. Returns issues with severity (error/warning/info) plus a summary count.

**`n8n_list_schedules`** - scans `n8n-nodes-base.scheduleTrigger` and the legacy `n8n-nodes-base.cron` nodes across workflows and decodes each interval rule into a human-readable string. Answers "what's running at 3am?" without clicking through the n8n UI. Supported rule fields: `seconds` / `minutes` / `hours` / `days` / `weeks` / `months` (with `triggerAtHour`, `triggerAtMinute`, `triggerAtDay`, `triggerAtDayOfMonth`) and raw `cronExpression`. One entry per interval — multi-interval rules emit multiple rows. Each row includes `workflowId`, `workflowName`, `active`, `nodeName`, `nodeType`, `schedule`, `field`, optional `cronExpression`, and the original `raw` rule for further inspection. Optional `workflowId` (single-workflow scan), `activeOnly` (default true — inactive schedules don't fire), `limit` (default 100, max 250).

**`n8n_diff_workflow`** - compare a workflow's current state against a snapshot. Pass `id` plus exactly one of `snapshotPath` (absolute path; `~` resolved) or `snapshot` (inline object). Snapshot accepts both shapes: the flat backup written by `n8n_save_workflow` / `n8n_delete_workflow`, and the nested `n8n_get_workflow(includeDefinition=true)` shape (graph data under `definition`). Returns `summary` (counts: added/removed/modified/nameChanged/connectionsChanged/settingsChanged) plus `diff` with per-node `fieldsChanged` paths (e.g. `parameters.command`, `parameters.url`, `disabled`). Node matching is two-pass: id first, then name fallback for any unmatched nodes — handles legacy/hand-edited snapshots. Cosmetic changes (`position`, `webhookId`) are suppressed by default; pass `ignoreCosmetic: false` to surface them. Per-node detail is capped at `maxModifiedDetails` (default 50, max 500); `summary.nodesModified` counter is uncapped and `diff.nodesModifiedTruncated: true` flags when detail was clipped. Read-only.

**`n8n_audit_browser_bridge_usage`** - scans every workflow for nodes that invoke the `browser-bridge` CLI. Inspects `command` (Execute Command + SSH nodes) and `jsCode` / `pythonCode` / `functionCode` (Code + legacy Function nodes). Heuristic: `\bbrowser-bridge\.[cm]?js` followed by two kebab-slug args; the bare bin form is intentionally not detected to avoid false positives from path mentions like `cd /opt/browser-bridge`. Returns one finding per `(workflowId, nodeName, platform, action)` plus a `summary` of platform×action counts. Optional `platform`, `action`, `activeOnly` (default false), `includeArchived` (default false), `maxWorkflows` (default 250, max 1000), `concurrency` (default 3, max 8). Read-only. Pairs with `n8n_scaffold_browser_bridge_node` when you need to add another call. Companion repo: [browser-bridge](https://github.com/solomonneas/browser-bridge).

**`n8n_scaffold_browser_bridge_node`** - pure local generator (no n8n API call). Given `platform`, `action`, optional `input` JSON, and `mode: "code-node" | "execute-command"` (default `code-node`), emits a ready-to-paste n8n node JSON that mirrors `browser-bridge`'s `docs/n8n-usage.md` patterns. The Code node uses `spawnSync` with stdin JSON and surfaces `payload.exitCode` + `stderr` so downstream nodes can branch on `ok`. The Execute Command node uses a quoted `<<'JSON'` heredoc so the input passes through unmangled. Optional `bridgeDir` (default `/home/user/.openclaw/workspace/pipeline/work/browser-bridge`), `nodeName`, `position`. Platform/action are validated as kebab slugs - keeps them safe to interpolate into the shell command. Warns when `execute-command` is used with non-empty `input` (heredoc bakes the JSON in; no per-item upstream wiring).

**`n8n_trigger`** - two modes:
- `mode: "webhook"` + `webhookPath` - POST (or GET/PUT/DELETE) to the configured base URL + path, with an optional JSON `payload`. This is the reliable path.
- `mode: "workflow"` + `workflowId` - attempts `POST /api/v1/workflows/:id/execute`. Pre-checks that the workflow is active and has a webhook/manual/form trigger. Most n8n builds don't expose this endpoint on the Public API and will 405; the tool surfaces a hint to switch to webhook mode.

**`n8n_create_workflow`** - `POST /workflows`. Accepts the full output of `n8n_get_workflow` (with `includeDefinition=true`) directly. Strips read-only fields (`id`, `active`, `createdAt`, `updatedAt`, `isArchived`, `versionId`, `triggerCount`, `tags`, `shared`, `meta`, `pinData`) before POSTing - n8n enforces `additionalProperties: false` on the workflow schema and will 400 on any readOnly field. Runs `n8n_validate_workflow` on the proposed state as a pre-check; errors block, warnings pass through (pass `skipValidation: true` to bypass). No confirm gate - creation is non-destructive. The new workflow is created INACTIVE; call `n8n_activate` afterwards if you want triggers running. This is the primary restore path for `n8n_delete_workflow` snapshots: read the backup file into `definition` and call this tool. The restored workflow gets a new id.

**`n8n_activate`** / **`n8n_deactivate`** - idempotent. Deactivating does not cancel running executions.

**`n8n_save_workflow`** - before writing: fetches the current version, snapshots it to `backupDir` as `<id>-<timestamp>.json` (mode 0600), runs `validateWorkflow` on the proposed state, and aborts on error-severity issues (pass `skipValidation: true` to bypass). Requires `confirm: true` to actually PUT; calling with `confirm: false` returns `ok: false` and never touches the API (omitting `confirm` is rejected at the MCP schema layer). Response includes the backup path and a `restoreHint`.

**`n8n_archive_workflow`** - `POST /workflows/{id}/archive`. Soft-deletes a workflow: triggers stop firing, the workflow disappears from the default UI list, but the definition and execution history are preserved. Idempotent (archiving an already-archived workflow returns the current state). No confirm gate - this is the safe cleanup path. Archiving deactivates as a side effect; the response surfaces `active: false` explicitly. Returns `ok: false` with `reason: "not_found"` on 404.

**`n8n_unarchive_workflow`** - `POST /workflows/{id}/unarchive`. Restores an archived workflow. Does NOT reactivate - triggers stay off until you call `n8n_activate` explicitly. Returns `ok: false` with `reason: "not_found"` on 404.

**`n8n_delete_workflow`** - `DELETE /workflows/{id}`. Permanent, irreversible. Before firing the DELETE: fetches the current workflow and snapshots it to `backupDir` as `<id>-DELETED-<timestamp>.json` (mode 0600). If the snapshot can't be written, the DELETE is aborted - there is no un-safety-netted path. Requires `confirm: true`; omitting it or passing `false` returns `ok: false` and never touches the API. Returns `ok: false` with `reason: "not_found"` on 404 (either before or after the snapshot). **Restore is one-call via `n8n_create_workflow`** with the snapshot contents; the restored workflow gets a new id and is created inactive. Deleting does NOT cancel running executions - use `n8n_list_executions(workflowId, status='running')` + `n8n_cancel_execution` first if needed. **Prefer `n8n_archive_workflow` for cleanup** if you want to preserve the original id.

**`n8n_cancel_execution`** - `POST /executions/{id}/stop`. Closes the triage loop after `n8n_search_executions` locates a stuck run. Returns a success summary with the execution's final status, or `ok: false` with `reason: "not_found_or_finished"` if the id no longer matches a running execution (404).

**`n8n_retry_execution`** - `POST /executions/{id}/retry`. Creates a NEW execution - the response surfaces both `originalExecutionId` and `newExecutionId` so agents can follow up with `n8n_get_execution` on the retry. Optional `loadWorkflow: true` retries against the currently saved workflow instead of the version captured at original execution time. Returns `ok: false` with `reason: "not_found"` on 404 or `reason: "not_retryable"` on 409 (e.g. still running); all other API errors rethrow.

**`n8n_delete_execution`** - `DELETE /executions/{id}`. Permanently removes an execution record: logs, per-node run data, and error payloads are erased from n8n. Requires `confirm: true` to actually delete; calling with `confirm: false` returns `ok: false` and never touches the API (omitting `confirm` is rejected at the MCP schema layer). Returns `ok: false` with `reason: "not_found"` on 404; all other API errors rethrow. Not idempotent from an agent's perspective: the record is gone after the first successful call, so fetch `n8n_get_execution` first if you may need it later.

**`n8n_pin_node_data`** - pin sample data to a node so downstream nodes use it during testing/development without re-running the upstream node. Pairs naturally with `n8n_scaffold_browser_bridge_node`: scaffold a browser-bridge call, run it once, capture the output, pin it, then iterate on downstream nodes without re-spawning the browser. Inputs: `id`, `nodeName` (case-sensitive, must match an existing node), `data` (1-50 items; raw objects are auto-wrapped into `{json: <object>}`, items already shaped as `{json: ..., binary?: ...}` pass through unchanged), optional `merge: true` to append to existing pinned data instead of replacing (combined still capped at 50), `confirm: true`. Issues PUT `/workflows/{id}` with merged `pinData` plus the existing nodes/connections/settings/staticData (so the PUT does not blank them). Pinned data persists across executions until cleared — easy to forget; the response includes an `unpinHint`.

**`n8n_unpin_node_data`** - clear pinned data on one node (when `nodeName` is supplied) or the whole workflow (when omitted). Idempotent: clearing a node that wasn't pinned returns `ok: true` with `noop: true` and never touches the API. When clearing actually happens, the PUT includes the rest of the workflow body so other fields are not blanked. Requires `confirm: true`.

**`n8n_delete_executions`** - batch form. Client-side fan-out over `DELETE /executions/{id}` with bounded concurrency (default 3, max 10). Takes an `ids` array (deduped before fan-out, capped at 50), requires `confirm: true`. Response surfaces `requested`/`attempted`/`deleted`/`alreadyDeleted`/`failed`/`skipped`/`aborted` counters plus a `results: Array<{id, ok, reason?, message?}>` - order is completion order, not input order, so look up by id. 404 per id is treated as `already_deleted` (idempotent). A 5xx on any id aborts the batch via an `AbortController`: no new ids are claimed and any already-in-flight `fetch`es are cancelled client-side. Under concurrency N, up to N-1 deletes may have already reached the server before the 5xx is observed, so the batch is best-effort, not transactional - clear signal the server is sick; don't retry blindly. Per-id error messages are passed through the API-key redactor. Compose with `n8n_search_executions` to purge a known set of noisy runs in one call.

**`n8n_retry_executions`** - batch form of retry. Same fan-out shape as `n8n_delete_executions`: bounded concurrency (default 3, max 10), capped at 50 ids, `AbortController` on 5xx, results in completion order. **Differs in two ways:** 404 per id is `{ ok: false, reason: "not_found" }` (NOT idempotent — a missing execution is a real failure to surface), and each successful retry creates a NEW execution whose id is returned per row as `newExecutionId`. Counters: `requested`/`attempted`/`retried`/`notFound`/`failed`/`skipped`/`aborted`. Optional `loadWorkflow: true` retries every id against the currently saved workflow instead of the captured version. Confirm-gated — each retry runs the workflow again and may re-trigger side effects (HTTP calls, DB writes); verify the workflow is safe to re-run before confirming.

**`n8n_run_audit`** - `POST /audit`. Runs n8n's built-in security audit and returns one risk report per requested category: **credentials** (unused/abandoned), **database** (SQL-injection-prone expressions in query nodes), **nodes** (community/unofficial nodes), **filesystem** (host fs access from nodes), **instance** (insecure server settings). Each report has `risk`, `sections` (with `title`/`description`/`recommendation`/`location`). The tool also surfaces a flat `reports` array with per-report `sectionCount`/`locationCount` so an agent can decide what to drill into without reparsing the whole audit. Optional `categories` (omit for all five) and `daysAbandonedWorkflow` (n8n default 90). Read-only — n8n only inspects, never mutates. **Requires the API user to be an instance admin or owner** (n8n's audit endpoint enforces this).

**`n8n_find_workflows_using_node_type`** - composed read-only scanner. Walks every workflow (paginated, capped at `maxWorkflows`, default 250 / max 1000) and emits one finding per node matching the requested type. `match: "exact"` (default) is full-string equality on `node.type`; `match: "contains"` is case-insensitive substring (handy for "all Slack nodes across base + community packages"). Optional `activeOnly` (default false), `includeArchived` (default false), `includeDisabledNodes` (default true — disabled nodes are common drift signals worth surfacing), `concurrency` (default 3, max 8). Returns per-node `findings` plus a per-workflow `summary` sorted by match count descending. Per-workflow fetch errors land in `fetchErrors` instead of failing the whole scan. Pairs with `n8n_audit_browser_bridge_usage` (which schedules drive my browser-bridge calls?) and `n8n_run_audit` (which deprecated nodes need replacing?).

**`n8n_execution_stats`** - composed read-only aggregator over `n8n_list_executions`. Per-workflow counts (total/success/error/canceled/running/waiting/other), failure rate (`error / (success + error + canceled)`), avg + p95 runtime over completed executions, and `lastFailureAt` / `lastSuccessAt`. Optional `workflowId` (single-workflow stats), `sinceHours` (default 24, max 168 = 7d), `maxExecutions` (default 1000, max 5000), `pageSize` (default 250). Pagination stops on the first execution older than the window OR at `maxExecutions`; `stoppedReason` is one of `"window"`, `"cap"`, `"exhausted"`. If `truncated: true`, increase `maxExecutions` or narrow `sinceHours`. The `totals` object includes the same counts + `failureRate` rolled across all workflows in the window. Useful for "which workflows are flaky?" and "what's running long?"

**`n8n_list_tags`** - `GET /tags`. Returns `{ data: [{id, name, createdAt, updatedAt}], nextCursor }`. Optional `limit` (default 100, max 250) and `cursor` (from a previous call's `nextCursor`). Read-only.

**`n8n_get_workflow_tags`** - `GET /workflows/{id}/tags`. Returns the array of tag objects currently attached. Pairs with `n8n_set_workflow_tags` for diffs and reattach flows.

**`n8n_create_tag`** - `POST /tags`. No confirm gate — creating a tag is reversible via `n8n_delete_tag` and harmless on its own. The name is trimmed before send. Returns `ok: false` with `reason: "conflict"` on 409 (tag with this name already exists); use `n8n_list_tags` to find the existing id.

**`n8n_delete_tag`** - `DELETE /tags/{id}`. Confirm-gated. **Cascades**: n8n removes the tag from every workflow it was attached to. The workflows themselves are NOT deleted, only the tag association. Returns `ok: false` with `reason: "not_found"` on 404. To find affected workflows beforehand, use `n8n_list_workflows(tags=<name>)` or scan `n8n_get_workflow_tags`.

**`n8n_set_workflow_tags`** - `PUT /workflows/{id}/tags`. **REPLACES** the workflow's tag set (not append) — pass the full desired list. Empty `tagIds: []` clears all tags. Tag ids are deduped before send. No confirm gate (reversible by re-setting). Returns `ok: false` with `reason: "not_found"` on 404 (the workflow id OR one of the tag ids does not exist; verify both with `n8n_list_workflows` and `n8n_list_tags`).

**`n8n_list_credentials`** - `GET /credentials`. Returns metadata only — n8n's API explicitly excludes the `data` field (encrypted secrets) from list responses, and the tool layer strips `data` defensively in case of a future regression. Each row: `{id, name, type, createdAt, updatedAt, shared[]}`. Optional `limit` (default 100, max 250) and `cursor`. Requires the API key to belong to an instance owner or admin — non-admin keys get `ok: false, reason: "unauthorized"` with a clear hint.

**`n8n_get_credential_schema`** - `GET /credentials/schema/{credentialTypeName}`. Returns the raw JSON Schema describing the required `data` shape for a credential type (e.g. `freshdeskApi` → `{ apiKey, domain }` required). Use this **before** calling `n8n_create_credential` so you know what fields to populate. 404 returns `reason: "not_found"`; 401 returns `reason: "unauthorized"`.

**`n8n_find_workflows_using_credential`** - composed scanner (no direct n8n endpoint). Walks workflows and inspects every node's `credentials` field. Pass either `credentialId` (exact, preferred) or `credentialName` (case-insensitive substring fallback). Returns one finding per `(workflowId, nodeName, credentialType)` plus a per-workflow summary count. Same fan-out shape as `n8n_audit_browser_bridge_usage` (bounded concurrency, `fetchErrors` for per-workflow failures, `truncated` flag, `maxWorkflows` default 250). The answer to "I'm rotating Slack creds, where do I need to update?" — run this **before** `n8n_delete_credential` to see the blast radius.

**`n8n_check_disabled_nodes`** - composed scanner. Surfaces every node with `disabled: true` across recent workflows. One finding per `(workflowId, nodeName, nodeType)` plus per-workflow disabled count, sorted desc. Disabled nodes are common drift signals (frozen mid-debug, forgotten cleanup) and the n8n UI doesn't list them anywhere obvious. Same fan-out + filter shape as the other scanners.

**`n8n_create_credential`** - `POST /credentials`. **Double-gated**: requires both `enableEdit` AND `enableCredentialsWrite` (default false). Confirm-gated. `data` carries plaintext secrets to n8n; the tool layer **never** echoes `data` back, even on error — n8n 400s with body content are wrapped to a status-only error before surfacing, so secrets cannot leak via validation messages. Pre-call: use `n8n_get_credential_schema` to learn the required `data` shape. Post-call: response includes `id`, `name`, `type`, timestamps; no `data`. NOT idempotent — calling twice with the same name creates two credentials.

**`n8n_delete_credential`** - `DELETE /credentials/{id}`. **Double-gated** + confirm-gated. **Cascades**: every workflow referencing this credential will fail on its next run — call `n8n_find_workflows_using_credential` first to enumerate the blast radius. 404 returns `reason: "not_found"`. The deleted-credential payload echoed by n8n has `data` stripped at the tool layer regardless of upstream behavior.

</details>

## Security model

Two flags gate write access, with deliberately different blast radii:

- **`enableEdit`** (default `false`) - exposes the workflow + execution lifecycle write tools (create/save/archive/delete workflows, cancel/retry/delete executions, pin/unpin node data, tag CRUD). Destructive tools are confirm-gated and the destructive workflow ones snapshot to `backupDir` first.
- **`enableCredentialsWrite`** (default `false`) - **second gate**, on top of `enableEdit`, required to expose `n8n_create_credential` and `n8n_delete_credential`. An agent that has been overprovisioned with `enableEdit` cannot inject or destroy credentials without this separate, deliberate config change.

Both flags must be true for credential writes to register. The credential **read** tools (`list-credentials`, `get-credential-schema`, `find-workflows-using-credential`) and the disabled-node scanner are always available regardless.

Why credentials get a second gate:
1. `create-credential` is the only tool in this package where agent input contains plaintext secrets. A prompt-injected or confused agent with `enableEdit` shouldn't be able to inject credentials.
2. `delete-credential` cascades — every workflow referencing the credential fails on its next run. The blast radius is wider than any single workflow operation.

Defense-in-depth on `data`:
- n8n's OpenAPI marks `data` as `writeOnly` — the API contract excludes it from every response. We trust but verify: **the tool layer strips `data` from every credential response before surfacing**, including success paths and the deleted-credential echo, so a future n8n regression can't leak secrets through us.
- On `create-credential` errors, the n8n response body (which can echo back fragments of submitted `data` on validation 400s) is replaced at the client layer with a status-only error message. The tool surfaces `status` + `path` only. Tests assert no portion of a forced-400 request body reaches the tool response.

## Install

```bash
npm install -g n8n-ops-mcp
```

## Configuration

Generate an API key in n8n under **Settings → API**, then set these env vars in your MCP client config:

| Variable | Required | Default | Description |
|---|---|---|---|
| `N8N_BASE_URL` | yes | - | n8n base URL, e.g. `http://localhost:5678` |
| `N8N_API_KEY` | yes | - | n8n Public API key (`X-N8N-API-KEY`) |
| `N8N_ENABLE_EDIT` | no | `false` | Expose write tools |
| `N8N_ENABLE_CREDENTIALS_WRITE` | no | `false` | Second gate (on top of `N8N_ENABLE_EDIT`) for `n8n_create_credential` and `n8n_delete_credential`. See [Security model](#security-model). |
| `N8N_BACKUP_DIR` | no | `~/.n8n-backups` | Where `n8n_save_workflow` writes pre-save snapshots |
| `N8N_MAX_EXECUTION_LOG_BYTES` | no | `65536` | Cap on inline execution log bytes |
| `N8N_REQUEST_TIMEOUT_MS` | no | `15000` | HTTP timeout for n8n API calls |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "n8n": {
      "command": "n8n-ops-mcp",
      "env": {
        "N8N_BASE_URL": "http://localhost:5678",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add n8n \
  --env N8N_BASE_URL=http://localhost:5678 \
  --env N8N_API_KEY=your-api-key-here \
  -- n8n-ops-mcp
```

Add `--scope user` to make it available from any directory instead of only the current project.

### Codex CLI

```bash
codex mcp add n8n \
  --env N8N_BASE_URL=http://localhost:5678 \
  --env N8N_API_KEY=your-api-key-here \
  -- n8n-ops-mcp
```

Writes the entry to `~/.codex/config.toml` under `[mcp_servers.n8n]`. Verify with `codex mcp list`.

### Cursor / Windsurf / other MCP hosts

Any MCP-compatible client that accepts a stdio command + env will work. Point it at the `n8n-ops-mcp` binary with `N8N_BASE_URL` and `N8N_API_KEY` in the environment.

<details>
<summary><b>Hermes Agent</b></summary>

[Hermes Agent](https://github.com/NousResearch/hermes-agent) reads MCP config from `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  n8n:
    command: "n8n-ops-mcp"
    env:
      N8N_BASE_URL: "http://localhost:5678"
      N8N_API_KEY: "your-api-key-here"
```

Then reload from inside a session:

```
/reload-mcp
```

</details>

### OpenClaw (first-class plugin)

n8n-ops-mcp was built for OpenClaw and ships as a first-class plugin - not an MCP bridge - so it shares the gateway's process, auth profiles, and hooks.

```bash
openclaw plugins install clawhub:n8n-ops-mcp
```

Add the config block to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "n8n": {
        "enabled": true,
        "config": {
          "baseUrl": "http://your-n8n-host:5678",
          "enableEdit": false
        }
      }
    }
  }
}
```

Put the API key in your OpenClaw workspace env:

```bash
# ~/.openclaw/workspace/.env
N8N_API_KEY=eyJhbGciOi...
```

Restart the gateway:

```bash
systemctl --user restart openclaw-gateway
```

Config keys: `baseUrl`, `apiKey`, `apiKeyEnv`, `enableEdit`, `enableCredentialsWrite`, `maxExecutionLogBytes`, `requestTimeoutMs`, `backupDir`. See [`openclaw.plugin.json`](./openclaw.plugin.json) for the full schema and the [Security model](#security-model) for the two-gate write design.

<details>
<summary><b>OpenClaw - manual (non-ClawHub) install</b></summary>

If you want to point OpenClaw at a local clone instead of the registry:

```json
{
  "plugins": {
    "allow": ["n8n"],
    "load": {
      "paths": ["/absolute/path/to/n8n-ops-mcp"]
    },
    "entries": {
      "n8n": {
        "enabled": true,
        "config": {
          "baseUrl": "http://your-n8n-host:5678",
          "enableEdit": false
        }
      }
    }
  }
}
```

</details>

## Example prompts

> What n8n workflows broke today?

Calls `n8n_list_executions` with `status=error`, then `n8n_get_execution` for the failing run.

> Which workflow errored with "ECONNREFUSED"?

Calls `n8n_search_executions` with `query: "ECONNREFUSED"`.

> Trigger the "nightly intel" workflow

Calls `n8n_list_webhooks` to find the path, then `n8n_trigger` with `mode=webhook`.

> What's running at 3am?

Calls `n8n_list_schedules`, then filters the result for any schedule whose description contains "03:00" (or whose `cronExpression` matches an early-morning hour).

> What changed in my "intel pipeline" workflow since yesterday's backup?

Calls `n8n_diff_workflow` with `id` and `snapshotPath` pointing to the backup file. Returns added/removed/modified nodes with parameter-level field paths.

> Where am I calling Linktree sync from?

Calls `n8n_audit_browser_bridge_usage` with `platform: "linktree"` to list every node (across all workflows) that invokes `browser-bridge linktree <action>`.

> Add a CoderLegion `scan-comments` step to a new workflow

Calls `n8n_scaffold_browser_bridge_node` with `platform: "coderlegion"`, `action: "scan-comments"`, `input: {limit: 5}` to get a Code node JSON, then pastes it into n8n.

> Pin a sample browser-bridge response on the "BB call" node so I can iterate on downstream parsing without re-spawning the browser *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_get_execution` to grab the most recent successful output of the node, then `n8n_pin_node_data` with `nodeName: "BB call"`, `data: <captured items>`, `confirm: true`. Clear later via `n8n_unpin_node_data`.

> Audit my workflows for deprecated Code-node API usage

Calls `n8n_list_workflows` then `n8n_validate_workflow` per id, filters for `code-node-old-node-ref` and `code-node-items-global` warnings.

> Deactivate the "experimental-bot" workflow *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_list_workflows` with a name filter, then `n8n_deactivate` on the matching id.

> Kill the execution stuck on ECONNREFUSED *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_search_executions` with `query: "ECONNREFUSED"`, then `n8n_cancel_execution` on the match.

> Retry yesterday's failed "nightly intel" run against the current workflow *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_search_executions` to find the failed id, then `n8n_retry_execution` with `loadWorkflow: true`.

> Purge the noisy test-run execution logs from last week *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_search_executions` to find the ids, then `n8n_delete_executions` with `confirm: true` to purge up to 50 in one call. Deletion is irreversible.

> Archive the old "staging-bot" workflow - I might need it back someday *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_list_workflows` with a name filter, then `n8n_archive_workflow` on the match. Reversible via `n8n_unarchive_workflow` (you'll still need `n8n_activate` to turn triggers back on).

> Delete the abandoned "poc-scraper" workflow - it's been dead for months *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_list_workflows` to find the id, then `n8n_delete_workflow` with `confirm: true`. A snapshot lands in `backupDir` first; restore is one-call via `n8n_create_workflow` with the snapshot. Prefer `n8n_archive_workflow` if you want to preserve the original id.

> Restore the workflow I accidentally deleted yesterday - backup is at `~/.n8n-backups/wf-42-DELETED-2026-04-22_15-00-00.json` *(requires `N8N_ENABLE_EDIT=true`)*

Reads the backup file, calls `n8n_create_workflow` with `definition=<backup contents>`. Read-only fields are stripped automatically; the restored workflow gets a new id and starts inactive. Call `n8n_activate` on the new id to re-enable triggers.

> Clone workflow "intel-nightly" to "intel-nightly-staging" for testing *(requires `N8N_ENABLE_EDIT=true`)*

Calls `n8n_get_workflow` with `includeDefinition=true`, changes `name` to "intel-nightly-staging" in the definition, then `n8n_create_workflow`. The new workflow is a full copy, inactive, with a fresh id.

## Development

```bash
npm install
npm run dev       # tsx on mcp-server.ts (MCP stdio)
npm run typecheck
npm test          # vitest run
npm run build     # tsup bundle to dist/mcp-server.js
npm start         # node dist/mcp-server.js (post-build)
```

Or install from source:

```bash
git clone https://github.com/solomonneas/n8n-ops-mcp.git
cd n8n-ops-mcp
npm install
npm run build
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

## License

MIT
