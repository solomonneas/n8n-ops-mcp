# Contributing to n8n-ops-mcp

n8n-ops-mcp is an ops-focused [Model Context Protocol](https://modelcontextprotocol.io) server for [n8n](https://n8n.io): list, trigger, validate, and audit n8n workflows from an AI client. Patches are welcome. Before you start, please skim this file so we both spend our time on the right things.

## What kinds of changes land easily

- **Bug fixes** in any tool, the n8n API client, the write/confirm gates, or the MCP stdio wrapper.
- **Sharper error handling**: better `reason` codes, clearer refusal hints, more defensive redaction.
- **New read-only ops tools** that answer a real n8n operations question the existing tools do not (e.g. a new composed scanner).
- **Test coverage** for any of the above, especially around the write gates and the API-key/credential redactors.
- **Docs**: clearer tool descriptions, accurate env-var tables, more useful example prompts.

## What needs a conversation first

- **A new write tool**, or widening the blast radius of an existing one. Write tools sit behind `enableEdit` (and credential writes behind a second gate) for a reason. Open an issue describing the user story first.
- **Changes to the security model**: the two-gate write design, the `snapshotPath` confinement in `n8n_diff_workflow`, the `data` stripping on credential responses, or the confirm-gate contract. These are the safety surface; renaming or loosening them later is painful.
- **Breaking changes** to tool names, input schemas, or env-var names. They are the public surface for every MCP client.

## What does not land

- Personal details, hostnames, IPs, account IDs, API keys, or live credentials in code, tests, or docs. The `content-guard` check fails if it finds any. Use `192.0.2.x` (RFC 5737) and `https://n8n.example.com` in examples.
- Tools that echo credential `data` or the n8n API key in any response or error path.
- A write or credential-write tool that mutates the instance without honoring `confirm: true` and the relevant enable flag.
- AI-co-authorship trailers on commits (`Co-Authored-By: <model>`). Conventional commits only.

## Local dev

```bash
git clone https://github.com/lidless-labs/n8n-ops-mcp.git
cd n8n-ops-mcp
npm install
npm run dev       # tsx on mcp-server.ts (MCP stdio)
npm run typecheck
npm test          # vitest run
npm run build     # tsup bundle to dist/mcp-server.js
```

Tests run against a shared fake-fetch harness (`tests/helpers/fake-fetch.ts`); you do not need a live n8n instance to develop or test most changes. When you do want to smoke-test against a real instance, point `N8N_BASE_URL` and `N8N_API_KEY` at a throwaway n8n and keep `N8N_ENABLE_EDIT` off until you are exercising a write tool on purpose.

## Adding a tool

1. Add the tool module under `src/tools/<name>.ts`.
2. Register it so it surfaces in both the MCP server and the OpenClaw plugin path.
3. If it is a write, gate it behind `enableEdit` and require `confirm: true`; if it touches credentials, gate it behind `enableCredentialsWrite` as well and strip `data` from every response branch.
4. Add a row to the tool table and a `Detailed tool reference` entry in `README.md`.
5. Add tests covering the happy path plus the gate/refusal paths.
6. Add an entry to the `Unreleased` section of `CHANGELOG.md`.

## Filing issues

Please use the templates under `.github/ISSUE_TEMPLATE/`. They exist to save you from re-typing your n8n version and config shape every time. Before posting any output, remove your n8n API key, private hostnames, account names, and unredacted absolute paths.

For questions and longer-form guidance, prefer the project website at <https://lidless.dev/n8n-ops-mcp> over a new issue.

## License

By contributing you agree that your contribution is licensed under the MIT License, same as the rest of the repo.
