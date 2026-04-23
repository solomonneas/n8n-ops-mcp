import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { N8nClient } from "./src/client.ts";
import { makeClient, resolveConfig, type N8nPluginConfig } from "./src/config.ts";
import { createListWorkflowsTool } from "./src/tools/list-workflows.ts";
import { createGetWorkflowTool } from "./src/tools/get-workflow.ts";
import { createListExecutionsTool } from "./src/tools/list-executions.ts";
import { createGetExecutionTool } from "./src/tools/get-execution.ts";

export default definePluginEntry({
  id: "n8n",
  name: "n8n Ops",
  description:
    "List, inspect, and trigger n8n workflows from OpenClaw agents. Optional edit tools behind a flag with auto-backup and rollback on failure.",
  register(api) {
    if (api.registrationMode !== "full") return;

    const config = resolveConfig(api.pluginConfig);
    const getClient = lazyClient(config);

    api.registerTool(createListWorkflowsTool(getClient) as AnyAgentTool);
    api.registerTool(createGetWorkflowTool(getClient) as AnyAgentTool);
    api.registerTool(createListExecutionsTool(getClient) as AnyAgentTool);
    api.registerTool(
      createGetExecutionTool({
        getClient,
        maxLogBytes: config.maxExecutionLogBytes,
      }) as AnyAgentTool,
    );
  },
});

function lazyClient(config: N8nPluginConfig): () => N8nClient {
  let cached: N8nClient | undefined;
  return () => {
    if (!cached) cached = makeClient(config);
    return cached;
  };
}
