# Security Policy

## Supported versions

n8n-ops-mcp is pre-1.0. Only the latest minor release on the `main` branch receives security fixes. Pin to a published version (`n8n-ops-mcp@<version>`) if you need a known-good build.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Email **me@solomonneas.dev** with: <!-- content-guard: allow pii/email -->

- A short description of the issue.
- Steps to reproduce (or a minimal proof of concept).
- The version or commit you tested against.
- Whether you would like to be credited in the release notes.

You should get an acknowledgment within 72 hours. If you do not, please follow up - the mail may have been filtered.

## In scope

- Leaks of the n8n API key, credential `data`, or other secrets through any tool response, error path, or log line.
- Path-traversal or arbitrary-file-read flaws in `n8n_diff_workflow` (the `snapshotPath` confinement to `backupDir`) or in backup/snapshot writes.
- Write-gate bypasses: a read-only configuration (`enableEdit=false`) exposing or executing a write tool, or `enableEdit` alone exposing credential writes without `enableCredentialsWrite`.
- `n8n_trigger` redirecting a call off the configured `N8N_BASE_URL` (the `webhookPath` validator should reject `..` traversal and scheme-relative `//host` forms).
- Confirm-gate bypasses: a destructive tool mutating the n8n instance without an explicit `confirm: true`.

## Write tools execute real n8n side effects

When `N8N_ENABLE_EDIT=true`, this server can run, create, overwrite, archive, and delete workflows and executions on the n8n instance you point it at. `n8n_trigger`, `n8n_activate`, `n8n_create_workflow`, and `n8n_save_workflow` cause n8n to execute arbitrary Code / Execute Command / HTTP nodes, which can have any real-world side effect those nodes are wired to.

- Keep `enableEdit` off unless you specifically want an agent to mutate the instance, and keep `enableCredentialsWrite` off unless you specifically want it to create or destroy credentials.
- Destructive operations are confirm-gated and snapshot to `backupDir` first, but that is a safety net for mistakes, not a security boundary against a hostile prompt. The boundary is the two config flags plus the n8n API key's own permissions.
- Scope the n8n API key to the minimum role the agent needs. Audit-only tools (`n8n_run_audit`, `n8n_list_credentials`) require an instance owner/admin key; do not hand out an admin key just to read workflows.

## Out of scope

- Bugs in n8n itself, or in n8n's Public API - report those to [n8n](https://github.com/n8n-io/n8n).
- Bugs in OpenClaw, Claude Code, Claude Desktop, Codex, Cursor, or other MCP hosts - report those to their respective projects.
- Issues that require an attacker to already have write access to your machine, your MCP client config, or your n8n API key.
- Workflows or credentials that you created and that behave as you configured them. This server surfaces and operates your n8n; it does not police what you put in it.

## Disclosure

We aim to ship a fix within 14 days of confirming a valid report. A coordinated disclosure timeline can be negotiated for issues that need longer.
