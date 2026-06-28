import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { N8nClient } from "./src/client.ts";
import { makeClient, type N8nPluginConfig } from "./src/config.ts";

import { createListWorkflowsTool } from "./src/tools/list-workflows.ts";
import { createGetWorkflowTool } from "./src/tools/get-workflow.ts";
import { createListExecutionsTool } from "./src/tools/list-executions.ts";
import { createGetExecutionTool } from "./src/tools/get-execution.ts";
import { createSearchExecutionsTool } from "./src/tools/search-executions.ts";
import { createTriggerTool } from "./src/tools/trigger.ts";
import { createListWebhooksTool } from "./src/tools/list-webhooks.ts";
import { createValidateWorkflowTool } from "./src/tools/validate-workflow.ts";
import { createActivateTool } from "./src/tools/activate.ts";
import { createDeactivateTool } from "./src/tools/deactivate.ts";
import { createSaveWorkflowTool } from "./src/tools/save-workflow.ts";
import { createCancelExecutionTool } from "./src/tools/cancel-execution.ts";
import { createRetryExecutionTool } from "./src/tools/retry-execution.ts";
import { createDeleteExecutionTool } from "./src/tools/delete-execution.ts";
import { createDeleteExecutionsTool } from "./src/tools/delete-executions.ts";
import {
  createArchiveWorkflowTool,
  createUnarchiveWorkflowTool,
} from "./src/tools/archive-workflow.ts";
import { createDeleteWorkflowTool } from "./src/tools/delete-workflow.ts";
import { createCreateWorkflowTool } from "./src/tools/create-workflow.ts";
import { createAuditBrowserBridgeUsageTool } from "./src/tools/audit-browser-bridge-usage.ts";
import { createScaffoldBrowserBridgeNodeTool } from "./src/tools/scaffold-browser-bridge-node.ts";
import { createDiffWorkflowTool } from "./src/tools/diff-workflow.ts";
import { createPinNodeDataTool } from "./src/tools/pin-node-data.ts";
import { createUnpinNodeDataTool } from "./src/tools/unpin-node-data.ts";
import { createListSchedulesTool } from "./src/tools/list-schedules.ts";
import { createListTagsTool } from "./src/tools/list-tags.ts";
import { createGetWorkflowTagsTool } from "./src/tools/get-workflow-tags.ts";
import { createCreateTagTool } from "./src/tools/create-tag.ts";
import { createDeleteTagTool } from "./src/tools/delete-tag.ts";
import { createSetWorkflowTagsTool } from "./src/tools/set-workflow-tags.ts";
import { createRunAuditTool } from "./src/tools/run-audit.ts";
import { createRetryExecutionsTool } from "./src/tools/retry-executions.ts";
import { createFindWorkflowsUsingNodeTypeTool } from "./src/tools/find-workflows-using-node-type.ts";
import { createExecutionStatsTool } from "./src/tools/execution-stats.ts";
import { createListCredentialsTool } from "./src/tools/list-credentials.ts";
import { createGetCredentialSchemaTool } from "./src/tools/get-credential-schema.ts";
import { createFindWorkflowsUsingCredentialTool } from "./src/tools/find-workflows-using-credential.ts";
import { createCreateCredentialTool } from "./src/tools/create-credential.ts";
import { createDeleteCredentialTool } from "./src/tools/delete-credential.ts";
import { createCheckDisabledNodesTool } from "./src/tools/check-disabled-nodes.ts";

const VERSION = "0.14.0";

function readConfigFromEnv(): N8nPluginConfig {
  const baseUrl = (process.env.N8N_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error(
      "N8N_BASE_URL is required (e.g. http://localhost:5678). Set it in your MCP client env config.",
    );
  }
  const apiKeyEnv = (process.env.N8N_API_KEY_ENV ?? "N8N_API_KEY").trim() || "N8N_API_KEY";
  const apiKey = (process.env[apiKeyEnv] ?? "").trim();
  if (!apiKey) {
    throw new Error(
      `${apiKeyEnv} is required. Set it in your MCP client env config (generate an API key in n8n under Settings -> API).`,
    );
  }
  return {
    baseUrl,
    apiKeyInline: apiKey,
    apiKeyEnv,
    enableEdit: parseBool(process.env.N8N_ENABLE_EDIT) ?? false,
    enableCredentialsWrite:
      parseBool(process.env.N8N_ENABLE_CREDENTIALS_WRITE) ?? false,
    maxExecutionLogBytes: parsePosInt("N8N_MAX_EXECUTION_LOG_BYTES", 65_536, 1024),
    requestTimeoutMs: parsePosInt("N8N_REQUEST_TIMEOUT_MS", 15_000, 1000),
    backupDir: (process.env.N8N_BACKUP_DIR ?? "").trim() || undefined,
  };
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return undefined;
}

function parsePosInt(envName: string, fallback: number, min: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(
      `${envName} must be an integer >= ${min} (got ${JSON.stringify(raw)}).`,
    );
  }
  return n;
}

function lazyClient(config: N8nPluginConfig): () => N8nClient {
  let cached: N8nClient | undefined;
  return () => {
    if (!cached) cached = makeClient(config);
    return cached;
  };
}

type ToolFactoryResult = {
  name: string;
  description: string;
  execute: (toolCallId: string, rawParams: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  }>;
};

function bind<Shape extends z.ZodRawShape>(
  server: McpServer,
  tool: ToolFactoryResult,
  shape: Shape,
): void {
  const handler = async (args: unknown): Promise<CallToolResult> => {
    const res = await tool.execute("mcp", args as Record<string, unknown>);
    return { content: res.content };
  };
  server.tool(tool.name, tool.description, shape, handler as never);
}

export function buildServer(config: N8nPluginConfig): McpServer {
  const getClient = lazyClient(config);

  const server = new McpServer({
    name: "n8n-ops-mcp",
    version: VERSION,
    description:
      "Ops-focused n8n tools: list, inspect, trigger, validate, and safely edit workflows via the n8n Public API.",
  });

  bind(server, createListWorkflowsTool(getClient), {
    active: z.boolean().optional().describe("Filter by active state. Omit for all."),
    tags: z.string().optional().describe("Comma-separated tag names to filter by."),
    name: z.string().optional().describe("Case-insensitive substring match on workflow name."),
    limit: z.number().int().min(1).max(250).optional().describe("Max rows (default 100)."),
  });

  bind(server, createGetWorkflowTool(getClient), {
    id: z.string().describe("Workflow id (from n8n_list_workflows)."),
    includeDefinition: z
      .boolean()
      .optional()
      .describe(
        "Include full nodes+connections JSON. Off by default. Turn on when you need to inspect or edit.",
      ),
  });

  bind(server, createListExecutionsTool(getClient), {
    workflowId: z.string().optional().describe("Filter to a single workflow id. Omit for all."),
    status: z
      .enum(["success", "error", "running", "waiting", "canceled"])
      .optional()
      .describe("Filter by execution status."),
    limit: z.number().int().min(1).max(250).optional().describe("Max rows (default 50)."),
  });

  bind(
    server,
    createGetExecutionTool({
      getClient,
      maxLogBytes: config.maxExecutionLogBytes,
    }),
    {
      id: z.string().describe("Execution id (from n8n_list_executions)."),
      includeRunData: z
        .boolean()
        .optional()
        .describe(
          "Include per-node run log. Default true. Turn off for just status + error summary.",
        ),
    },
  );

  bind(server, createSearchExecutionsTool(getClient), {
    query: z
      .string()
      .min(1)
      .describe(
        "Case-insensitive text to search for (e.g. 'ECONNREFUSED').",
      ),
    workflowId: z
      .string()
      .optional()
      .describe("Filter to a single workflow id. Omit to scan across all workflows."),
    status: z
      .enum(["success", "error", "running", "waiting", "canceled"])
      .optional()
      .describe(
        "Filter executions by status before searching. Default 'error'.",
      ),
    scope: z
      .enum(["error", "all"])
      .optional()
      .describe(
        "'error' (default) searches only the execution error payload. 'all' also greps the full per-node run log — slower and may return raw node output in snippets.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe("Max executions to scan (default 50)."),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Stop after this many matches (default 20)."),
    snippetChars: z
      .number()
      .int()
      .min(40)
      .max(600)
      .optional()
      .describe("Context window around each match (default 160)."),
  });

  bind(
    server,
    createListWebhooksTool({ getClient, baseUrl: config.baseUrl }),
    {
      workflowId: z.string().optional().describe("Restrict to a single workflow."),
      activeOnly: z.boolean().optional().describe("Only include active workflows. Default true."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max workflows to scan when workflowId is omitted (default 50)."),
    },
  );

  bind(server, createValidateWorkflowTool(getClient), {
    id: z.string().describe("Workflow id (from n8n_list_workflows)."),
  });

  bind(server, createAuditBrowserBridgeUsageTool(getClient), {
    platform: z
      .string()
      .optional()
      .describe(
        "Filter findings to a single browser-bridge platform (e.g. 'coderlegion').",
      ),
    action: z
      .string()
      .optional()
      .describe(
        "Filter findings to a single browser-bridge action (e.g. 'scan-comments').",
      ),
    activeOnly: z
      .boolean()
      .optional()
      .describe(
        "Only scan active workflows. Default false - inactive workflows often hide stale browser-bridge calls.",
      ),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived workflows in the scan. Default false."),
    maxWorkflows: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe("Cap on workflows fetched and inspected (default 250)."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Parallel getWorkflow requests (default 3, max 8)."),
  });

  bind(server, createScaffoldBrowserBridgeNodeTool(), {
    platform: z
      .string()
      .min(1)
      .describe("Browser-bridge platform slug (e.g. 'coderlegion')."),
    action: z
      .string()
      .min(1)
      .describe("Browser-bridge action (e.g. 'scan-comments', 'draft-post')."),
    input: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("JSON input passed on stdin to the browser-bridge call."),
    mode: z
      .enum(["execute-command", "code-node"])
      .optional()
      .describe(
        "Which n8n node shape to emit. 'code-node' (default) handles JSON I/O via spawnSync. 'execute-command' is a heredoc shell call.",
      ),
    bridgeDir: z
      .string()
      .optional()
      .describe(
        "Absolute path to the browser-bridge checkout on the n8n host. Default matches docs/n8n-usage.md.",
      ),
    nodeName: z
      .string()
      .optional()
      .describe(
        "Override the generated node name. Default 'Browser Bridge: <platform> <action>'.",
      ),
    position: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("n8n canvas position [x, y]. Default [0, 0]."),
  });

  bind(server, createListSchedulesTool(getClient), {
    workflowId: z
      .string()
      .optional()
      .describe("Restrict the scan to a single workflow. Omit to scan recent workflows."),
    activeOnly: z
      .boolean()
      .optional()
      .describe(
        "Only include schedules from active workflows. Default true — inactive schedules don't fire.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe(
        "When workflowId is omitted, max workflows to fetch and scan (default 100).",
      ),
  });

  bind(server, createListTagsTool(getClient), {
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe("Max tags returned (default 100)."),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous call's `nextCursor`."),
  });

  bind(server, createGetWorkflowTagsTool(getClient), {
    id: z.string().describe("Workflow id (from n8n_list_workflows)."),
  });

  bind(server, createRunAuditTool(getClient), {
    categories: z
      .array(
        z.enum(["credentials", "database", "nodes", "filesystem", "instance"]),
      )
      .optional()
      .describe(
        "Restrict the audit to specific risk categories. Omit for all five.",
      ),
    daysAbandonedWorkflow: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe(
        "Days a workflow must go unexecuted to count as abandoned in the credentials report. n8n default is 90.",
      ),
    includeDetails: z
      .boolean()
      .optional()
      .describe(
        "Return full per-finding `location` arrays (credential ids/names, node ids). Default false: locations stripped from audit body, only counts surfaced.",
      ),
  });

  bind(server, createFindWorkflowsUsingNodeTypeTool(getClient), {
    nodeType: z
      .string()
      .min(1)
      .describe(
        "n8n node type to search for (e.g. 'n8n-nodes-base.slack', 'n8n-nodes-base.httpRequest').",
      ),
    match: z
      .enum(["exact", "contains"])
      .optional()
      .describe(
        "Match mode (default 'exact'). 'contains' is case-insensitive substring match.",
      ),
    activeOnly: z
      .boolean()
      .optional()
      .describe("Only scan active workflows. Default false."),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived workflows in the scan. Default false."),
    includeDisabledNodes: z
      .boolean()
      .optional()
      .describe(
        "Include disabled nodes in findings. Default true (disabled nodes are common drift signals).",
      ),
    maxWorkflows: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe("Cap on workflows fetched (default 250)."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Parallel getWorkflow requests (default 3, max 8)."),
  });

  bind(server, createExecutionStatsTool(getClient), {
    workflowId: z
      .string()
      .optional()
      .describe("Restrict stats to a single workflow id. Omit for per-workflow stats across the instance."),
    sinceHours: z
      .number()
      .min(0.25)
      .max(168)
      .optional()
      .describe(
        "Window in hours (default 24, max 168 = 7d). Pagination stops when an execution older than the window is seen.",
      ),
    maxExecutions: z
      .number()
      .int()
      .min(50)
      .max(5000)
      .optional()
      .describe(
        "Hard cap on executions inspected (default 1000). If `truncated: true`, increase this or narrow `sinceHours`.",
      ),
    pageSize: z
      .number()
      .int()
      .min(50)
      .max(250)
      .optional()
      .describe("Page size for /executions calls (default 250)."),
  });

  bind(server, createListCredentialsTool(getClient), {
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe("Max credentials returned (default 100)."),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous call's `nextCursor`."),
  });

  bind(server, createGetCredentialSchemaTool(getClient), {
    credentialTypeName: z
      .string()
      .min(1)
      .describe(
        "n8n credential type name (e.g. 'githubApi', 'slackOAuth2Api').",
      ),
  });

  bind(server, createFindWorkflowsUsingCredentialTool(getClient), {
    credentialId: z
      .string()
      .optional()
      .describe(
        "Exact credential id to match (preferred). Either this or credentialName is required.",
      ),
    credentialName: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring match on credential name. Either this or credentialId is required.",
      ),
    activeOnly: z
      .boolean()
      .optional()
      .describe("Only scan active workflows. Default false."),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived workflows in the scan. Default false."),
    maxWorkflows: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        "Cap on workflows INSPECTED (default 250). Counted after the active/archived filter, so the scanner may page through more list rows than this when many archived workflows are skipped, but it will not fetch more than `maxWorkflows` full workflow definitions.",
      ),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Parallel getWorkflow requests (default 3, max 8)."),
  });

  bind(server, createCheckDisabledNodesTool(getClient), {
    activeOnly: z
      .boolean()
      .optional()
      .describe("Only scan active workflows. Default false."),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived workflows. Default false."),
    maxWorkflows: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        "Cap on workflows INSPECTED (default 250). Counted after the active/archived filter, so the scanner may page through more list rows than this when many archived workflows are skipped, but it will not fetch more than `maxWorkflows` full workflow definitions.",
      ),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Parallel getWorkflow requests (default 3, max 8)."),
  });

  bind(server, createDiffWorkflowTool({ getClient, backupDir: config.backupDir }), {
    id: z.string().describe("Workflow id to fetch as the 'after' side of the diff."),
    snapshotPath: z
      .string()
      .optional()
      .describe(
        "Path to a JSON snapshot file (e.g. n8n_save_workflow backup). MUST resolve inside the configured backupDir (default ~/.n8n-backups); paths outside it or with `..` traversal are rejected. Use this OR `snapshot`.",
      ),
    snapshot: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Inline snapshot object — accepts the flat backup shape OR the nested n8n_get_workflow(includeDefinition=true) shape. Use this OR `snapshotPath`.",
      ),
    ignoreCosmetic: z
      .boolean()
      .optional()
      .describe(
        "Suppress position-only and webhookId-only node changes (default true).",
      ),
    maxModifiedDetails: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Cap on per-node modification entries returned in `diff.nodesModified` (default 50). Counters in `summary` are NOT capped.",
      ),
  });

  if (config.enableEdit) {
    bind(server, createTriggerTool(getClient), {
      mode: z
        .enum(["workflow", "webhook"])
        .describe(
          "'workflow' triggers by workflow id (manual-style; most builds 405). 'webhook' POSTs to a webhook path.",
        ),
      workflowId: z
        .string()
        .optional()
        .describe("Required when mode=workflow. Id from n8n_list_workflows."),
      webhookPath: z
        .string()
        .optional()
        .describe("Required when mode=webhook. Path after the base URL, e.g. /webhook/my-hook."),
      payload: z.record(z.string(), z.unknown()).optional().describe("Optional JSON body."),
      method: z
        .enum(["POST", "GET", "PUT", "DELETE"])
        .optional()
        .describe("HTTP method for webhook mode. Default POST."),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually run the workflow. Triggering executes arbitrary workflow nodes (Code/Execute Command/HTTP) and POSTs to webhooks with real side effects.",
        ),
    });

    bind(server, createActivateTool(getClient), {
      id: z.string().describe("Workflow id to activate."),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually activate. Arms the workflow's triggers, so its nodes (Code/Execute Command/HTTP) can start running automatically.",
        ),
    });

    bind(server, createDeactivateTool(getClient), {
      id: z.string().describe("Workflow id to deactivate."),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually deactivate. Stops the workflow's triggers from firing until re-activated.",
        ),
    });

    bind(
      server,
      createSaveWorkflowTool({ getClient, backupDir: config.backupDir }),
      {
        id: z.string().describe("Workflow id to overwrite."),
        definition: z
          .object({
            name: z.string().optional(),
            nodes: z.array(z.record(z.string(), z.unknown())),
            connections: z.record(z.string(), z.unknown()),
            settings: z.record(z.string(), z.unknown()).optional(),
            staticData: z.unknown().optional(),
          })
          .loose()
          .describe(
            "Full new workflow body. Copy from n8n_get_workflow with includeDefinition=true, modify, then pass back.",
          ),
        skipValidation: z
          .boolean()
          .optional()
          .describe("Skip the validate-workflow pre-check. Default false."),
        confirm: z
          .boolean()
          .describe("Must be true to actually write. Snapshot to backupDir happens regardless."),
      },
    );

    bind(server, createCancelExecutionTool(getClient), {
      id: z
        .string()
        .describe(
          "Execution id to stop (from n8n_list_executions or n8n_search_executions).",
        ),
    });

    bind(server, createRetryExecutionTool(getClient), {
      id: z
        .string()
        .describe(
          "Execution id to retry (from n8n_list_executions or n8n_search_executions). The response contains a NEW execution id.",
        ),
      loadWorkflow: z
        .boolean()
        .optional()
        .describe(
          "If true, retry against the currently saved workflow instead of the version captured at the original execution time. Omit to accept n8n's default.",
        ),
    });

    bind(server, createDeleteExecutionTool(getClient), {
      id: z
        .string()
        .describe(
          "Execution id to delete (from n8n_list_executions or n8n_search_executions).",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually delete. Deletion is irreversible: execution logs, per-node run data, and error payloads are erased.",
        ),
    });

    bind(server, createDeleteExecutionsTool(getClient), {
      ids: z
        .array(z.string())
        .min(1)
        .describe(
          "Execution ids to delete (from n8n_search_executions or n8n_list_executions). Deduped server-side; non-empty required.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually delete. Deletion is irreversible: execution logs, per-node run data, and error payloads are erased.",
        ),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Parallel DELETE requests. Default 3. Keep low - n8n shares a database."),
    });

    bind(server, createArchiveWorkflowTool(getClient), {
      id: z.string().describe("Workflow id to archive (from n8n_list_workflows)."),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually archive. Soft-deletes and deactivates the workflow; triggers stop firing. Reversible via n8n_unarchive_workflow.",
        ),
    });

    bind(server, createUnarchiveWorkflowTool(getClient), {
      id: z.string().describe("Workflow id to unarchive (from n8n_list_workflows)."),
    });

    bind(
      server,
      createDeleteWorkflowTool({ getClient, backupDir: config.backupDir }),
      {
        id: z.string().describe("Workflow id to delete (from n8n_list_workflows)."),
        confirm: z
          .boolean()
          .describe(
            "Must be true to actually delete. A snapshot is written to backupDir before the DELETE; restore via n8n_create_workflow with the snapshot. Prefer n8n_archive_workflow for reversible cleanup that preserves the id.",
          ),
      },
    );

    bind(server, createCreateWorkflowTool({ getClient }), {
      definition: z
        .object({
          name: z.string(),
          nodes: z.array(z.record(z.string(), z.unknown())).optional(),
          connections: z.record(z.string(), z.unknown()).optional(),
          settings: z.record(z.string(), z.unknown()).nullable().optional(),
          staticData: z.unknown().optional(),
        })
        .loose()
        .describe(
          "Workflow body to create. Accepts either a flat snapshot (n8n_delete_workflow backup file, nodes at top level) or the nested n8n_get_workflow(includeDefinition=true) shape (graph data under `definition`, null settings/staticData allowed). Read-only fields are stripped. Primary restore path for n8n_delete_workflow snapshots.",
        ),
      skipValidation: z
        .boolean()
        .optional()
        .describe("Skip the validate-workflow pre-check. Default false."),
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Must be true to actually create (unless dryRun:true). Accepts an arbitrary nodes graph that will exist on the server. Ignored for dry runs.",
        ),
    });

    bind(server, createPinNodeDataTool(getClient), {
      id: z.string().describe("Workflow id (from n8n_list_workflows)."),
      nodeName: z
        .string()
        .min(1)
        .describe(
          "Name of the node to pin data on (case-sensitive). Must be the n8n node 'name' field, not the type.",
        ),
      data: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(50)
        .describe(
          "Items to pin (max 50). Each item may be a fully-shaped n8n run item (`{json: {...}}`) or a raw object — raw objects are auto-wrapped into `{json: <object>}`.",
        ),
      merge: z
        .boolean()
        .optional()
        .describe(
          "If true, append to existing pinned data on the node instead of replacing (combined total still capped at 50). Default false.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually write. Pinned data persists across executions and overrides node output until cleared.",
        ),
    });

    bind(server, createUnpinNodeDataTool(getClient), {
      id: z.string().describe("Workflow id (from n8n_list_workflows)."),
      nodeName: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Name of the node to unpin (case-sensitive). Omit to clear ALL pinned data on the workflow.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually clear pinned data. Idempotent: clearing a node that wasn't pinned returns ok=true with noop=true.",
        ),
    });

    bind(server, createCreateTagTool(getClient), {
      name: z
        .string()
        .min(1)
        .max(100)
        .describe(
          "Tag name (e.g. 'production'). Must be unique — n8n returns 409 on conflict.",
        ),
      confirm: z
        .boolean()
        .describe("Must be true to actually create the tag. Reversible via n8n_delete_tag."),
    });

    bind(server, createDeleteTagTool(getClient), {
      id: z.string().describe("Tag id (from n8n_list_tags)."),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually delete. Cascades — n8n removes the tag from every workflow it was attached to.",
        ),
    });

    bind(server, createSetWorkflowTagsTool(getClient), {
      id: z.string().describe("Workflow id (from n8n_list_workflows)."),
      tagIds: z
        .array(z.string())
        .describe(
          "Full desired set of tag ids (from n8n_list_tags). REPLACES — not append. Empty array clears all tags.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually write. REPLACES the workflow's entire tag set; empty tagIds clears all tags.",
        ),
    });

    bind(server, createRetryExecutionsTool(getClient), {
      ids: z
        .array(z.string())
        .min(1)
        .describe(
          "Execution ids to retry. Each retry creates a NEW execution; response includes newExecutionId per row.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to actually retry. Each retry runs the workflow again and may re-trigger side effects (HTTP calls, DB writes).",
        ),
      loadWorkflow: z
        .boolean()
        .optional()
        .describe(
          "If true, retry against the currently saved workflow instead of the version captured at original execution time. Applied to every id.",
        ),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Parallel retry POSTs. Default 3."),
    });

    if (config.enableCredentialsWrite) {
      bind(server, createCreateCredentialTool(getClient), {
        name: z
          .string()
          .min(1)
          .max(200)
          .describe("Display name for the credential."),
        type: z
          .string()
          .min(1)
          .describe(
            "n8n credential type name (e.g. 'githubApi'). Use n8n_get_credential_schema to confirm the data shape.",
          ),
        data: z
          .record(z.string(), z.unknown())
          .describe(
            "Credential body matching the schema for `type`. Carries plaintext secrets — never echoed back, even on error.",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be true to actually create. Creation injects secrets that persist long-term.",
          ),
      });

      bind(server, createDeleteCredentialTool(getClient), {
        id: z.string().describe("Credential id (from n8n_list_credentials)."),
        confirm: z
          .boolean()
          .describe(
            "Must be true to actually delete. Cascades — every workflow referencing this credential will fail on its next run.",
          ),
      });
    }
  }

  return server;
}

export async function serve(): Promise<void> {
  const config = readConfigFromEnv();
  const server = buildServer(config);

  const transport = new StdioServerTransport();
  // Strip the draft-07 `$schema` the MCP SDK stamps on tool schemas; Anthropic
  // rejects it ("must match JSON Schema draft 2020-12") when the full tool set
  // is sent, e.g. on subagent spawns. Intercept tools/list output here.
  const __send = transport.send.bind(transport);
  (transport as any).send = (message: any) => {
    const tools = message?.result?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (t?.inputSchema) delete t.inputSchema.$schema;
        if (t?.outputSchema) delete t.outputSchema.$schema;
      }
    }
    return __send(message);
  };
  await server.connect(transport);
}
