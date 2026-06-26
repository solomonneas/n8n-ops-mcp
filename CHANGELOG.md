# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- README rewritten to lead with what / why / how-it-differs: ops-focused n8n MCP server, prominent website link, a copy-paste MCP client config that runs via `npx -y n8n-ops-mcp`, a keyword-rich "What it does" section, and explicit "Why not the bigger n8n MCP projects?" and "What n8n-ops-mcp is not" sections. Example hostnames are now a neutral `https://n8n.example.com`.

### Added
- Maintainer-health files: `SECURITY.md` (in/out-of-scope, write-tool side-effect warning, vulnerability reporting), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, GitHub issue templates (`bug.yml`, `feature.yml`, `config.yml` with `blank_issues_enabled: false` and contact links), and a pull request template with a no-PII / content-guard checkbox.

Docs and repo metadata only. No behavior changes.

## [0.14.0] - 2026-04-27

### Added
- `n8n_list_credentials` - `GET /credentials`. Returns metadata only — n8n's API contract excludes the encrypted `data` field, and the tool layer strips `data` defensively in case of regression. Each row: `{id, name, type, createdAt, updatedAt, shared[]}`. Requires the API key to belong to an instance owner/admin; 401 surfaces as `{ ok: false, reason: "unauthorized" }` with a clear hint.
- `n8n_get_credential_schema` - `GET /credentials/schema/{credentialTypeName}`. Returns the raw JSON Schema for a credential type's required `data` shape. 404 → `reason: "not_found"`. Use before `n8n_create_credential`.
- `n8n_find_workflows_using_credential` - composed read-only scanner. Pass either `credentialId` (exact, preferred) or `credentialName` (case-insensitive substring). Returns one finding per `(workflowId, nodeName, credentialType)` plus per-workflow match counts. Same fan-out shape as `n8n_audit_browser_bridge_usage` (bounded concurrency, `fetchErrors` for per-workflow failures, `truncated` flag, `maxWorkflows` default 250). Pre-`n8n_delete_credential` blast-radius answer.
- `n8n_check_disabled_nodes` - composed read-only scanner. Surfaces every node with `disabled: true` across recent workflows; the n8n UI doesn't list them anywhere obvious.
- `n8n_create_credential` - `POST /credentials`. **Double-gated**: requires both `enableEdit` AND `enableCredentialsWrite` (default false). Confirm-gated. The tool layer NEVER echoes `data` back, even on error: the client wraps n8n's response body in a status-only `N8nApiError` before re-throwing, so secrets cannot leak via 400 validation messages.
- `n8n_delete_credential` - `DELETE /credentials/{id}`. **Double-gated** + confirm-gated. Cascades — every workflow referencing the credential will fail on its next run; the refusal hint points to `n8n_find_workflows_using_credential` for blast-radius enumeration. 404 → `reason: "not_found"`. The deleted-credential payload has `data` stripped at the tool layer regardless of upstream behavior.
- New plugin config flag `enableCredentialsWrite` (default false) and matching env var `N8N_ENABLE_CREDENTIALS_WRITE`. `enableEdit` alone never exposes credential writes.

### Notes
- Tool count is now 36. README has a new "Security model" section documenting the two-gate write design, the redaction-at-tool-layer pattern, and the body-stripping-on-error guarantee for `create-credential`.
- Endpoint shapes verified against the live n8n OpenAPI spec at `/api/v1/openapi.yml`. `data` is `writeOnly` on every relevant schema; we trust but verify with defensive redaction.
- Deferred to 0.15.0+ if real demand surfaces: `PATCH /credentials/{id}` (update), `PUT /credentials/{id}/transfer` (project transfer), variables CRUD, projects API.

## [0.13.0] - 2026-04-27

### Added
- `n8n_run_audit` - exposes n8n's built-in security audit (`POST /audit`). One risk report per requested category: credentials (unused/abandoned), database (SQL injection-prone expressions), nodes (community packages), filesystem (host fs access), instance (insecure server settings). Optional `categories` filter and `daysAbandonedWorkflow`. Read-only. Requires the API user to be an instance admin or owner.
- `n8n_find_workflows_using_node_type` - composed read-only scanner. Walks every workflow (paginated, capped at `maxWorkflows`) and emits one finding per matching node + a per-workflow summary. `match: "exact"` (default) or `match: "contains"` for case-insensitive substring. Optional `activeOnly`, `includeArchived`, `includeDisabledNodes` (default true). Per-workflow fetch errors land in `fetchErrors` instead of failing the whole scan.
- `n8n_execution_stats` - composed aggregator over `/executions`. Per-workflow counts, failure rate, avg + p95 runtime, last failure/success timestamps over a window (default 24h, max 7d). Pagination stops at the window boundary OR `maxExecutions`; `stoppedReason` surfaces `"window"`/`"cap"`/`"exhausted"` so callers can decide when to widen.
- `n8n_list_tags` - `GET /tags`, paginated.
- `n8n_get_workflow_tags` - `GET /workflows/{id}/tags`.
- `n8n_create_tag` - `POST /tags`. No confirm gate (reversible). 409 surfaces as `{ ok: false, reason: "conflict" }`.
- `n8n_delete_tag` - `DELETE /tags/{id}`. Confirm-gated. **Cascades** — n8n removes the tag from every workflow it was attached to. 404 surfaces as `{ ok: false, reason: "not_found" }`.
- `n8n_set_workflow_tags` - `PUT /workflows/{id}/tags`. **REPLACES** the tag set (empty array clears all tags). Tag ids deduped before send. No confirm (reversible by re-setting). 404 covers both missing workflow id and missing tag id.
- `n8n_retry_executions` - batch retry. Mirrors `n8n_delete_executions` (bounded concurrency, capped at 50, `AbortController` on 5xx) but 404 per id is `not_found`, NOT idempotent. Each row returns `newExecutionId` for the spawned retry. Optional `loadWorkflow` retries every id against the current saved version.

### Fixed
- `n8n_scaffold_browser_bridge_node` schema: `position` is now `Type.Array(Type.Number(), { minItems: 2, maxItems: 2 })` instead of `Type.Tuple([Type.Number(), Type.Number()])`. OpenAI rejects tool schemas with array-valued `items` (the tuple form), causing cron jobs to fail before any n8n call. The fixed-length homogeneous array form is OpenAI-compatible.

### Notes
- Tool count is now 30. The README tool table is split implicitly by the `Write` column; consider splitting into separate read/write tables in 0.14.0+.
- Tag, audit, and find-workflows-using-node-type endpoints all verified against the live n8n OpenAPI spec (`/api/v1/openapi.yml`) — the endpoint shapes documented in the OpenAPI match what we ship. The `/api/v1/openapi.json` path 404s; only `.yml` works (re-confirmed from 0.7.0).
- Deferred to 0.14.0: credentials list/CRUD (`/credentials/*`) and variables CRUD (`/variables/*`). Both verified present in the API; their secret-handling surfaces deserve a dedicated review pass.

## [0.12.0] - 2026-04-25

### Added
- `n8n_list_schedules` - read-only scanner that walks every workflow for `n8n-nodes-base.scheduleTrigger` and legacy `n8n-nodes-base.cron` nodes and decodes each interval rule into a human-readable string. Supported rule fields: `seconds` / `minutes` / `hours` / `days` / `weeks` (with multi-day `triggerAtDay`) / `months` plus raw `cronExpression`. Multi-interval rules emit one row per interval. Each row includes workflow context, node name/type, the human description, the rule field, optional `cronExpression`, and the original `raw` rule for further inspection. Optional `workflowId` (single-workflow scan), `activeOnly` (default true - inactive schedules don't fire), `limit` (default 100, max 250).

### Notes
- Answers the most common cron ops question ("what's running at 3am?") that n8n's UI doesn't surface anywhere obvious. Pairs naturally with `n8n_audit_browser_bridge_usage` (which schedules drive my browser-bridge calls?) and `n8n_diff_workflow` (did the cron rule change since the snapshot?).

## [0.11.0] - 2026-04-25

### Added
- `n8n_pin_node_data` - edit-mode tool that pins sample data on a single node so downstream nodes use it during development/testing without re-running the upstream node. Inputs: `id`, `nodeName` (validated to exist in the workflow), `data` (1-50 items; raw objects auto-wrap into `{json: <object>}`, fully-shaped `{json, binary?}` items pass through), optional `merge: true` to append (combined still ≤50), `confirm: true`. PUT body includes nodes/connections/settings/staticData from current state so those fields are not blanked. Response includes `unpinHint` since pinned data is easy to forget about.
- `n8n_unpin_node_data` - clear pinned data on one node (`nodeName` supplied) or the whole workflow (`nodeName` omitted). Idempotent: clearing a node that wasn't pinned returns `ok: true, noop: true` and never touches the API. Confirm-gated.

### Notes
- Both go through PUT `/workflows/:id` (n8n's Public API doesn't have a dedicated pinData endpoint). They use the existing `client.saveWorkflow` primitive but bypass the snapshot+validation of `n8n_save_workflow` since pin/unpin only mutate `pinData` and the change is reversible via the sibling tool.
- Composes with `n8n_scaffold_browser_bridge_node`: scaffold a call, run it once, pin the output, iterate downstream without re-spawning the browser.

## [0.10.0] - 2026-04-25

### Added
- `n8n_diff_workflow` - read-only semantic diff between a workflow's current state and a snapshot. Inputs: `id` plus exactly one of `snapshotPath` (absolute file path; `~` resolved) or `snapshot` (inline object). Snapshot accepts both shapes: flat (`n8n_save_workflow` / `n8n_delete_workflow` backup) and nested (`n8n_get_workflow(includeDefinition=true)`). Returns counters in `summary` (added/removed/modified/nameChanged/connectionsChanged/settingsChanged) plus a `diff` payload with per-node `fieldsChanged` paths walking one level into `parameters` (e.g. `parameters.command`, `parameters.url`). Node matching is two-pass: id-first, name-fallback — handles legacy/hand-edited snapshots without forcing a "1 added + 1 removed" false signal. Cosmetic-only changes (`position`, `webhookId`) suppressed by default; toggle with `ignoreCosmetic: false`. Per-node detail capped at `maxModifiedDetails` (default 50, max 500) with an explicit `nodesModifiedTruncated` flag; `summary` counters are uncapped.

### Notes
- Closes the snapshot/restore loop opened in 0.7/0.8: you could save and restore but had no way to see what changed between them. Pairs with `n8n_save_workflow` (which writes the snapshot) and `n8n_audit_browser_bridge_usage` (which surfaces calls — diff tells you whether they've drifted).

## [0.9.0] - 2026-04-25

### Added
- `n8n_audit_browser_bridge_usage` - read-only scanner that walks every workflow and surfaces nodes calling the [`browser-bridge`](https://github.com/solomonneas/browser-bridge) CLI (Execute Command, Code, SSH, legacy Function). Returns one finding per `(workflowId, nodeName, platform, action)` plus a per-platform action summary. Optional filters: `platform`, `action`, `activeOnly`, `includeArchived`. Paginates via cursor up to `maxWorkflows` (default 250, max 1000) with bounded-concurrency `getWorkflow` fan-out (default 3, max 8). Per-workflow fetch failures land in `fetchErrors` instead of failing the whole audit. Detection regex requires the `.js` / `.cjs` / `.mjs` extension to avoid false positives from path mentions like `cd /opt/browser-bridge`.
- `n8n_scaffold_browser_bridge_node` - pure local generator (no n8n API call) that emits a ready-to-paste n8n node calling `browser-bridge <platform> <action>`. Two modes: `code-node` (default; `spawnSync` with stdin JSON, surfaces `exitCode` + `stderr`) and `execute-command` (quoted `<<'JSON'` heredoc). Mirrors the patterns in browser-bridge's `docs/n8n-usage.md`. Validates `platform` and `action` as kebab slugs to keep them safe to interpolate into shell commands. Warns when `execute-command` mode is paired with non-empty `input` (heredoc bakes input in; no per-item wiring).

### Notes
- Companion repo: [browser-bridge](https://github.com/solomonneas/browser-bridge). The two new tools are the first n8n-ops-mcp pieces designed to compose with browser-bridge end-to-end (find existing calls, then scaffold new ones).

## [0.8.1] - 2026-04-24

### Changed
- Reframed the README as MCP-first (any MCP-compatible client) while preserving the "built for OpenClaw" origin story and first-class plugin path.
- Refreshed package and plugin descriptions to cover the full workflow + execution lifecycle added in 0.7/0.8.
- Added this `CHANGELOG.md`.

No behavior changes. Docs and metadata only.

## [0.8.0] - 2026-04-23

### Added
- `n8n_create_workflow` - `POST /workflows`. Accepts `n8n_get_workflow(includeDefinition=true)` output directly, strips read-only fields, runs `validateWorkflow` as a pre-check. New workflow is created inactive. Primary restore path for `n8n_delete_workflow` snapshots (one-call restore).

## [0.7.0] - 2026-04-23

### Added
- `n8n_archive_workflow` - soft-delete. Reversible, preserves the original id, deactivates as a side effect.
- `n8n_unarchive_workflow` - restore an archived workflow. Does NOT reactivate triggers.
- `n8n_delete_workflow` - permanent delete. Confirm-gated, snapshots to `backupDir` before the DELETE; aborts if the snapshot can't be written. Restore via `n8n_create_workflow`.

## [0.6.0] - 2026-04-23

### Added
- `n8n_delete_executions` - batch form of delete-execution. Client-side fan-out with bounded concurrency (default 3, max 10), capped at 50 ids, confirm-gated. 404 per id is treated as `already_deleted` (idempotent). A 5xx on any id aborts the batch via an `AbortController` - no new ids claimed and in-flight requests cancelled client-side. Best-effort, not transactional.

## [0.5.1] - 2026-04-23

### Changed
- Consolidated per-test `createFakeClient` copies into a shared fake-fetch harness (`tests/helpers/fake-fetch.ts`).
- Added `N8nClient` wire-shape coverage so any drift from n8n's REST contract is caught at the HTTP boundary.

## [0.5.0] - 2026-04-23

### Added
- `n8n_delete_execution` - `DELETE /executions/{id}`. Confirm-gated, irreversible. Returns `ok: false` with `reason: "not_found"` on 404.

## [0.4.0] - 2026-04-23

### Added
- `n8n_retry_execution` - `POST /executions/{id}/retry`. Creates a NEW execution and surfaces both `originalExecutionId` and `newExecutionId`. Optional `loadWorkflow: true` retries against the currently saved workflow.

## [0.3.0] - 2026-04-23

### Added
- `n8n_cancel_execution` - `POST /executions/{id}/stop`. Closes the triage loop after `n8n_search_executions` locates a stuck run.

## [0.2.0] - 2026-04-23

### Added
- `n8n_search_executions` - text-search recent executions for an error fragment. Defaults to scanning `status=error` payloads; `scope: "all"` also greps per-node run data.

## [0.1.2] - 2026-04-23

### Added
- `openclaw.build.{openclawVersion,pluginSdkVersion}` in `package.json` for ClawHub publish metadata.

## [0.1.1] - 2026-04-23

### Added
- `openclaw.compat.pluginApi` in `package.json` for ClawHub publish.

## [0.1.0] - 2026-04-23

### Added
- Initial release. Read-only ops tools: `n8n_list_workflows`, `n8n_get_workflow`, `n8n_list_executions`, `n8n_get_execution`, `n8n_list_webhooks`, `n8n_validate_workflow`, `n8n_trigger`.
- Edit tools behind `enableEdit`: `n8n_activate`, `n8n_deactivate`, `n8n_save_workflow` (auto-backup + validation gate).
- MCP stdio wrapper so the plugin runs in any MCP-compatible client (Claude Desktop, Claude Code, Codex CLI, Hermes Agent).
- Built as a first-class OpenClaw plugin (shared gateway process, auth profiles, hooks).

[0.12.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.12.0
[0.11.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.11.0
[0.10.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.10.0
[0.9.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.9.0
[0.8.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.8.1
[0.8.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.8.0
[0.7.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.7.0
[0.6.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.6.0
[0.5.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.5.1
[0.5.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.5.0
[0.4.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.2.0
[0.1.2]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.0
