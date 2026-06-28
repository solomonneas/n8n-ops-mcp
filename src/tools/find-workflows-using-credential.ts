import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    credentialId: Type.Optional(
      Type.String({
        description:
          "Exact credential id to match (preferred). Find via n8n_list_credentials. Either this or `credentialName` is required.",
      }),
    ),
    credentialName: Type.Optional(
      Type.String({
        description:
          "Case-insensitive substring match on credential `name`. Use when you don't have the id (e.g. 'rotating Slack creds, where am I using anything called Slack?'). Either this or `credentialId` is required.",
      }),
    ),
    activeOnly: Type.Optional(
      Type.Boolean({
        description:
          "Only scan active workflows. Default false — inactive workflows still reference credentials and matter for rotation.",
      }),
    ),
    includeArchived: Type.Optional(
      Type.Boolean({
        description: "Include archived workflows in the scan. Default false.",
      }),
    ),
    maxWorkflows: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 1000,
        description:
          "Cap on workflows INSPECTED (default 250). Counted after the active/archived filter, so when many archived workflows are skipped the scanner may page through more list rows than this number — but it will not fetch more than `maxWorkflows` full workflow definitions.",
      }),
    ),
    concurrency: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 8,
        description:
          "Parallel getWorkflow requests (default 3, max 8).",
      }),
    ),
  },
  { additionalProperties: false },
);

const PAGE_SIZE = 100;
const DEFAULT_MAX_WORKFLOWS = 250;
const DEFAULT_CONCURRENCY = 3;

export interface CredentialMatch {
  workflowId: string;
  workflowName: string;
  active: boolean;
  archived: boolean;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
  credentialType: string;
  credentialId: string | null;
  credentialName: string | null;
}

export interface FindWorkflowsUsingCredentialOptions {
  credentialId?: string;
  credentialName?: string;
  activeOnly?: boolean;
  includeArchived?: boolean;
  maxWorkflows?: number;
  concurrency?: number;
}

export async function findWorkflowsUsingCredential(
  client: N8nClient,
  opts: FindWorkflowsUsingCredentialOptions,
): Promise<Record<string, unknown>> {
  const credentialId = opts.credentialId?.trim();
  const credentialName = opts.credentialName?.trim();
  if (!credentialId && !credentialName) {
    return {
      ok: false,
      action: "find_workflows_using_credential",
      reason: "missing_target",
      error: "exactly one of credentialId or credentialName is required",
    };
  }
  if (credentialId && credentialName) {
    // Schema doc says "exactly one"; refuse instead of silently
    // preferring id, so callers don't think their name fallback ran.
    return {
      ok: false,
      action: "find_workflows_using_credential",
      reason: "ambiguous_target",
      error:
        "pass exactly one of credentialId or credentialName — not both",
    };
  }
  const nameLower = credentialName?.toLowerCase();
  const activeOnly = opts.activeOnly === true;
  const includeArchived = opts.includeArchived === true;
  const maxWorkflows = opts.maxWorkflows ?? DEFAULT_MAX_WORKFLOWS;
  const concurrency = Math.max(
    1,
    Math.min(8, opts.concurrency ?? DEFAULT_CONCURRENCY),
  );

  {
      const summaries: Array<{ id: string; archived: boolean }> = [];
      let cursor: string | undefined;
      let truncated = false;
      while (summaries.length < maxWorkflows) {
        const remaining = maxWorkflows - summaries.length;
        const limit = Math.min(PAGE_SIZE, remaining);
        const page = await client.listWorkflows({
          active: activeOnly ? true : undefined,
          limit,
          cursor,
        });
        for (const w of page.data) {
          const archived = w.isArchived === true;
          if (archived && !includeArchived) continue;
          summaries.push({ id: String(w.id), archived });
          if (summaries.length >= maxWorkflows) break;
        }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (page.data.length === 0) break;
      }
      if (cursor) truncated = true;

      const definitions: N8nWorkflow[] = [];
      const fetchErrors: Array<{ workflowId: string; error: string }> = [];
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const i = nextIndex++;
          if (i >= summaries.length) return;
          const id = summaries[i].id;
          try {
            definitions.push(await client.getWorkflow(id));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            fetchErrors.push({ workflowId: id, error: client.redact(msg) });
          }
        }
      };
      const pool: Promise<void>[] = [];
      for (let i = 0; i < Math.min(concurrency, summaries.length); i++) {
        pool.push(worker());
      }
      await Promise.all(pool);

      const findings: CredentialMatch[] = [];
      const perWorkflow = new Map<
        string,
        {
          workflowName: string;
          active: boolean;
          archived: boolean;
          matchCount: number;
        }
      >();
      for (const wf of definitions) {
        if (!Array.isArray(wf.nodes)) continue;
        let wfMatchCount = 0;
        for (const rawNode of wf.nodes) {
          if (!rawNode || typeof rawNode !== "object") continue;
          const n = rawNode as Record<string, unknown>;
          const creds = n.credentials;
          if (!creds || typeof creds !== "object") continue;
          for (const [credType, credValue] of Object.entries(
            creds as Record<string, unknown>,
          )) {
            if (!credValue || typeof credValue !== "object") continue;
            const cv = credValue as { id?: unknown; name?: unknown };
            const id = typeof cv.id === "string" ? cv.id : null;
            const name = typeof cv.name === "string" ? cv.name : null;
            const matched = credentialId
              ? id === credentialId
              : nameLower
                ? name !== null && name.toLowerCase().includes(nameLower)
                : false;
            if (!matched) continue;
            findings.push({
              workflowId: String(wf.id),
              workflowName: wf.name,
              active: wf.active,
              archived: wf.isArchived === true,
              nodeId: typeof n.id === "string" ? n.id : null,
              nodeName: typeof n.name === "string" ? n.name : "",
              nodeType: String(n.type ?? ""),
              credentialType: credType,
              credentialId: id,
              credentialName: name,
            });
            wfMatchCount++;
          }
        }
        if (wfMatchCount > 0) {
          perWorkflow.set(String(wf.id), {
            workflowName: wf.name,
            active: wf.active,
            archived: wf.isArchived === true,
            matchCount: wfMatchCount,
          });
        }
      }

      const summary = Array.from(perWorkflow.entries())
        .map(([id, v]) => ({
          workflowId: id,
          workflowName: v.workflowName,
          active: v.active,
          archived: v.archived,
          matchCount: v.matchCount,
        }))
        .sort((a, b) => b.matchCount - a.matchCount);

      return {
        target: credentialId
          ? { kind: "id", value: credentialId }
          : { kind: "name", value: credentialName },
        scannedWorkflows: definitions.length,
        requestedMaxWorkflows: maxWorkflows,
        truncated,
        fetchErrors,
        workflowsWithMatches: summary.length,
        findingCount: findings.length,
        summary,
        findings,
      };
  }
}

export function createFindWorkflowsUsingCredentialTool(
  getClient: () => N8nClient,
) {
  return {
    name: "n8n_find_workflows_using_credential",
    label: "n8n: find workflows using credential",
    description:
      "Scan workflows and surface every node that references a given credential. Pass either `credentialId` (exact, preferred) or `credentialName` (case-insensitive substring fallback). Returns one finding per (workflowId, nodeName, credentialType) plus a per-workflow summary count. Read-only. Bounded-concurrency fan-out; per-workflow fetch errors land in `fetchErrors` instead of failing the whole scan. Pairs with n8n_run_audit and is the answer to 'I'm rotating <X> creds, where do I need to update?' before calling n8n_delete_credential.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await findWorkflowsUsingCredential(
          getClient(),
          rawParams as FindWorkflowsUsingCredentialOptions,
        ),
      );
    },
  };
}
