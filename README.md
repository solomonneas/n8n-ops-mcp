# openclaw-n8n

n8n ops plugin for [OpenClaw](https://github.com/openclaw/openclaw). List, inspect, trigger, and safely edit n8n workflows from OpenClaw agents.

Status: read-only tools (`n8n_list_workflows`, `n8n_get_workflow`, `n8n_list_executions`, `n8n_get_execution`). Trigger tool next.

## Why

OpenClaw agents have no native awareness of your n8n footprint. If a pipeline breaks, you SSH to the host or open the n8n UI. With this plugin, your main agent can answer "what's broken in my n8n?" from chat, and trigger manual workflows without you leaving Discord/Telegram.

## Tools

**`n8n_list_workflows`** - list workflows with optional `active`, `tags`, `name` (substring), `limit` filters. Returns id, name, active state, tags, updatedAt.

**`n8n_get_workflow`** - fetch one workflow by id. Returns metadata by default. Pass `includeDefinition: true` to get the full node graph + connections.

**`n8n_list_executions`** - list recent executions with optional `workflowId`, `status` (success/error/running/waiting/canceled), `limit` filters. Returns id, workflowId, workflowName, status, mode, startedAt, stoppedAt.

**`n8n_get_execution`** - fetch one execution by id. Includes per-node run log (truncated to `maxExecutionLogBytes`, default 64 KB, with a tail hint when it exceeds) and the raw error object verbatim when status is `error`. Pass `includeRunData: false` to skip the run log and get just status + error.

## Install

```bash
git clone https://github.com/solomonneas/openclaw-n8n.git
cd openclaw-n8n
npm install
```

Register in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["n8n"],
    "load": {
      "paths": ["/path/to/openclaw-n8n"]
    },
    "entries": {
      "n8n": {
        "enabled": true,
        "config": {
          "baseUrl": "http://your-n8n-host:5678"
        }
      }
    }
  }
}
```

Set the API key in your OpenClaw environment (generate in n8n under Settings -> API):

```bash
# ~/.openclaw/workspace/.env
N8N_API_KEY=eyJhbGciOi...
```

Restart the gateway so the env var loads:

```bash
systemctl --user restart openclaw-gateway
```

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | string | required | n8n base URL |
| `apiKey` | string | empty | Inline key. Prefer env var. |
| `apiKeyEnv` | string | `N8N_API_KEY` | Env var to read the key from if `apiKey` is blank. |
| `enableEdit` | boolean | `false` | Enable write tools (not yet implemented). |
| `maxExecutionLogBytes` | number | `65536` | Cap on inline execution log bytes. |
| `requestTimeoutMs` | number | `15000` | HTTP timeout. |
| `backupDir` | string | `~/.n8n-backups` | Pre-save snapshot directory. |

## Client setups

This plugin is for OpenClaw specifically. For other Claude-compatible clients, wrap the tools in an MCP server (not in scope yet).

- **OpenClaw:** see Install above.
- **Claude Desktop / Claude Code / Codex CLI / Hermes Agent:** pending, via MCP wrapper.

## Roadmap

- [x] `n8n_list_workflows`
- [x] `n8n_get_workflow`
- [x] `n8n_list_executions`
- [x] `n8n_get_execution`
- [ ] `n8n_trigger` (webhook + manual)
- [ ] `n8n_search_executions` (text search across run logs)
- [ ] `n8n_save_workflow` with auto-backup + rollback-on-failure (behind `enableEdit`)
- [ ] `n8n_activate` / `n8n_deactivate`
- [ ] `n8n_validate_workflow` (Code node + deprecated node checks)

## License

MIT
