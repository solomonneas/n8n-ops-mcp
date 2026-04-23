import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nExecution } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description: "Execution id (from n8n_list_executions).",
    }),
    includeRunData: Type.Optional(
      Type.Boolean({
        description:
          "Include the per-node run log. Default true. Turn off to get just status + error summary.",
      }),
    ),
  },
  { additionalProperties: false },
);

export interface GetExecutionDeps {
  getClient: () => N8nClient;
  maxLogBytes: number;
}

export function createGetExecutionTool(deps: GetExecutionDeps) {
  return {
    name: "n8n_get_execution",
    label: "n8n: get execution",
    description:
      "Fetch a single n8n execution by id. Returns status, mode, timing, and per-node run data. Large run logs are truncated with a tail hint. Error executions include the raw error verbatim.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as { id: string; includeRunData?: boolean };
      const includeRunData = params.includeRunData !== false;
      const ex: N8nExecution = await deps.getClient().getExecution(params.id, {
        includeData: includeRunData,
      });

      const status =
        ex.status ?? (ex.finished ? "success" : "running");
      const base = {
        id: String(ex.id),
        workflowId: String(ex.workflowId ?? ""),
        workflowName: ex.workflowData?.name ?? null,
        status,
        mode: ex.mode,
        finished: ex.finished,
        startedAt: ex.startedAt ?? null,
        stoppedAt: ex.stoppedAt ?? null,
        waitTill: ex.waitTill ?? null,
        retryOf: ex.retryOf ?? null,
        retrySuccessId: ex.retrySuccessId ?? null,
        lastNodeExecuted: ex.data?.resultData?.lastNodeExecuted ?? null,
      };

      const error = ex.data?.resultData?.error;
      const runData = ex.data?.resultData?.runData;

      const body: Record<string, unknown> = { ...base };
      if (error !== undefined) {
        body.error = error;
      }
      if (includeRunData && runData !== undefined) {
        body.runData = truncateRunData(runData, deps.maxLogBytes);
      }
      return jsonToolResult(body);
    },
  };
}

function truncateRunData(
  runData: unknown,
  maxBytes: number,
): unknown {
  const serialized = JSON.stringify(runData);
  const size = Buffer.byteLength(serialized, "utf8");
  if (size <= maxBytes) {
    return runData;
  }
  const tail = serialized.slice(-maxBytes);
  return {
    _truncated: true,
    _hint: `log exceeded ${maxBytes} bytes (actual ${size}), showing tail`,
    _tail: tail,
  };
}
