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

const inactive = list.data.find((w) => !w.active);
if (inactive) {
  console.log(`\nTrigger gating check against inactive workflow ${inactive.id} (${inactive.name}):`);
  try {
    await client.executeWorkflow(String(inactive.id), {});
    console.log("  (unexpected) executeWorkflow succeeded on inactive workflow");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  executeWorkflow rejected as expected: ${truncate(msg, 200)}`);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

console.log("\nScanning active workflows for webhook triggers:");
const activeList = await client.listWorkflows({ active: true, limit: 20 });
let webhookHits = 0;
for (const w of activeList.data) {
  const wf = await client.getWorkflow(w.id);
  if (!Array.isArray(wf.nodes)) continue;
  for (const raw of wf.nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    const type = String(node.type ?? "");
    if (type === "n8n-nodes-base.webhook" || type === "n8n-nodes-base.formTrigger") {
      const params = (node.parameters as Record<string, unknown>) ?? {};
      const path = typeof params.path === "string" ? params.path : (node.webhookId as string | undefined) ?? "";
      const method = typeof params.httpMethod === "string" ? params.httpMethod : "POST";
      console.log(`  - ${wf.name}  node=${node.name}  method=${method}  path=/webhook/${path}`);
      webhookHits++;
    }
  }
}
console.log(`  total webhooks found: ${webhookHits}`);

console.log("\nValidating first active workflow:");
const firstActive = activeList.data[0];
if (firstActive) {
  const { validateWorkflow } = await import("../src/tools/validate-workflow.ts");
  const wf = await client.getWorkflow(firstActive.id);
  const issues = validateWorkflow(wf);
  const err = issues.filter((i) => i.severity === "error").length;
  const warn = issues.filter((i) => i.severity === "warning").length;
  console.log(`  ${wf.name}: ${issues.length} issues (${err} error, ${warn} warning)`);
  for (const i of issues.slice(0, 5)) {
    console.log(`    [${i.severity}] ${i.code} ${i.nodeName ? `@${i.nodeName}` : ""}: ${i.message}`);
  }
}
