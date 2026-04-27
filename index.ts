import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { N8nClient } from "./src/client.ts";
import { makeClient, resolveConfig, type N8nPluginConfig } from "./src/config.ts";
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

export default definePluginEntry({
  id: "n8n",
  name: "n8n Ops",
  description:
    "Ops-focused n8n tools for OpenClaw agents: list, inspect, trigger, validate, plus full workflow + execution lifecycle (create, save, archive, delete, cancel, retry) behind an edit flag. Auto-backup + confirm gates on destructive writes.",
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
    api.registerTool(createSearchExecutionsTool(getClient) as AnyAgentTool);
    api.registerTool(createTriggerTool(getClient) as AnyAgentTool);
    api.registerTool(
      createListWebhooksTool({ getClient, baseUrl: config.baseUrl }) as AnyAgentTool,
    );
    api.registerTool(createValidateWorkflowTool(getClient) as AnyAgentTool);
    api.registerTool(
      createAuditBrowserBridgeUsageTool(getClient) as AnyAgentTool,
    );
    api.registerTool(
      createScaffoldBrowserBridgeNodeTool() as AnyAgentTool,
    );
    api.registerTool(createDiffWorkflowTool(getClient) as AnyAgentTool);
    api.registerTool(createListSchedulesTool(getClient) as AnyAgentTool);
    api.registerTool(createListTagsTool(getClient) as AnyAgentTool);
    api.registerTool(createGetWorkflowTagsTool(getClient) as AnyAgentTool);
    api.registerTool(createRunAuditTool(getClient) as AnyAgentTool);
    api.registerTool(
      createFindWorkflowsUsingNodeTypeTool(getClient) as AnyAgentTool,
    );
    api.registerTool(createExecutionStatsTool(getClient) as AnyAgentTool);
    api.registerTool(createListCredentialsTool(getClient) as AnyAgentTool);
    api.registerTool(
      createGetCredentialSchemaTool(getClient) as AnyAgentTool,
    );
    api.registerTool(
      createFindWorkflowsUsingCredentialTool(getClient) as AnyAgentTool,
    );
    api.registerTool(createCheckDisabledNodesTool(getClient) as AnyAgentTool);

    if (config.enableEdit) {
      api.registerTool(createActivateTool(getClient) as AnyAgentTool);
      api.registerTool(createDeactivateTool(getClient) as AnyAgentTool);
      api.registerTool(
        createSaveWorkflowTool({
          getClient,
          backupDir: config.backupDir,
        }) as AnyAgentTool,
      );
      api.registerTool(createCancelExecutionTool(getClient) as AnyAgentTool);
      api.registerTool(createRetryExecutionTool(getClient) as AnyAgentTool);
      api.registerTool(createDeleteExecutionTool(getClient) as AnyAgentTool);
      api.registerTool(createDeleteExecutionsTool(getClient) as AnyAgentTool);
      api.registerTool(createArchiveWorkflowTool(getClient) as AnyAgentTool);
      api.registerTool(createUnarchiveWorkflowTool(getClient) as AnyAgentTool);
      api.registerTool(
        createDeleteWorkflowTool({
          getClient,
          backupDir: config.backupDir,
        }) as AnyAgentTool,
      );
      api.registerTool(createCreateWorkflowTool({ getClient }) as AnyAgentTool);
      api.registerTool(createPinNodeDataTool(getClient) as AnyAgentTool);
      api.registerTool(createUnpinNodeDataTool(getClient) as AnyAgentTool);
      api.registerTool(createCreateTagTool(getClient) as AnyAgentTool);
      api.registerTool(createDeleteTagTool(getClient) as AnyAgentTool);
      api.registerTool(createSetWorkflowTagsTool(getClient) as AnyAgentTool);
      api.registerTool(createRetryExecutionsTool(getClient) as AnyAgentTool);

      if (config.enableCredentialsWrite) {
        api.registerTool(
          createCreateCredentialTool(getClient) as AnyAgentTool,
        );
        api.registerTool(
          createDeleteCredentialTool(getClient) as AnyAgentTool,
        );
      }
    }
  },
});

function lazyClient(config: N8nPluginConfig): () => N8nClient {
  let cached: N8nClient | undefined;
  return () => {
    if (!cached) cached = makeClient(config);
    return cached;
  };
}
