import { N8nClient } from "../src/client.ts";

const baseUrl = process.env.N8N_BASE_URL;
const apiKey = process.env.N8N_API_KEY;

if (!baseUrl || !apiKey) {
  console.error("Set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const client = new N8nClient({ baseUrl, apiKey, timeoutMs: 10_000 });

const list = await client.listWorkflows({ limit: 5 });
console.log(`Listed ${list.data.length} workflows:`);
for (const w of list.data) {
  console.log(`  - ${w.id}  ${w.active ? "[on] " : "[off]"}  ${w.name}`);
}

if (list.data.length > 0) {
  const first = list.data[0];
  const wf = await client.getWorkflow(first.id);
  const nodes = Array.isArray(wf.nodes) ? wf.nodes.length : 0;
  console.log(`\nFetched workflow ${wf.id} (${wf.name}): ${nodes} nodes`);
}

const executions = await client.listExecutions({ limit: 5 });
console.log(`\nListed ${executions.data.length} executions:`);
for (const ex of executions.data) {
  const status = ex.status ?? (ex.finished ? "success" : "running");
  console.log(
    `  - ${ex.id}  workflow=${ex.workflowId}  status=${status}  mode=${ex.mode}  started=${ex.startedAt ?? "?"}`,
  );
}

if (executions.data.length > 0) {
  const errored = executions.data.find((e) => e.status === "error")
    ?? executions.data[0];
  const detail = await client.getExecution(String(errored.id), {
    includeData: true,
  });
  const nodes = detail.data?.resultData?.runData
    ? Object.keys(detail.data.resultData.runData).length
    : 0;
  const hasError = detail.data?.resultData?.error !== undefined;
  console.log(
    `\nFetched execution ${detail.id}: status=${detail.status ?? "?"} nodes=${nodes} hasError=${hasError}`,
  );
  if (hasError) {
    const err = detail.data?.resultData?.error as Record<string, unknown> | undefined;
    const msg = err && typeof err.message === "string" ? err.message : "(no message)";
    console.log(`  error.message: ${msg}`);
  }
}
