import { Type } from "@sinclair/typebox";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";
import { validateWorkflow } from "./validate-workflow.ts";

const Schema = Type.Object(
  {
    id: Type.String({ description: "Workflow id to overwrite." }),
    definition: Type.Object(
      {
        name: Type.Optional(Type.String()),
        nodes: Type.Array(Type.Record(Type.String(), Type.Unknown())),
        connections: Type.Record(Type.String(), Type.Unknown()),
        settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        staticData: Type.Optional(Type.Unknown()),
      },
      {
        additionalProperties: true,
        description:
          "Full new workflow body. Copy from n8n_get_workflow with includeDefinition=true, modify, then pass the nodes + connections (+ optional settings/staticData/name) here.",
      },
    ),
    skipValidation: Type.Optional(
      Type.Boolean({
        description:
          "Skip the n8n_validate_workflow pre-check. Default false. Validation errors (not warnings) block the save by default.",
      }),
    ),
    confirm: Type.Boolean({
      description:
        "Must be true to actually write. A snapshot of the current workflow is saved to backupDir regardless.",
    }),
  },
  { additionalProperties: false },
);

export interface SaveWorkflowDeps {
  getClient: () => N8nClient;
  backupDir?: string;
}

export function createSaveWorkflowTool(deps: SaveWorkflowDeps) {
  return {
    name: "n8n_save_workflow",
    label: "n8n: save workflow",
    description:
      "Overwrite an n8n workflow. Snapshots the current version to backupDir first, runs n8n_validate_workflow on the proposed new state (errors block, warnings pass through), then PUTs the new body. Requires enableEdit and explicit confirm=true.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as {
        id: string;
        definition: Record<string, unknown>;
        skipValidation?: boolean;
        confirm: boolean;
      };
      if (!params.confirm) {
        return jsonToolResult({
          ok: false,
          error: "confirm must be true to save",
        });
      }
      const client = deps.getClient();

      const current = await client.getWorkflow(params.id);
      const backupPath = await writeBackup(
        resolveBackupDir(deps.backupDir),
        current,
      );

      if (!params.skipValidation) {
        const proposed: N8nWorkflow = {
          ...current,
          ...(params.definition as Partial<N8nWorkflow>),
          id: current.id,
        };
        const issues = validateWorkflow(proposed);
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length > 0) {
          return jsonToolResult({
            ok: false,
            error: "validation failed; save aborted",
            backupPath,
            issues,
          });
        }
      }

      const body = buildSaveBody(current, params.definition);
      try {
        const saved = await client.saveWorkflow(params.id, body);
        return jsonToolResult({
          ok: true,
          action: "save",
          workflowId: saved.id,
          workflowName: saved.name,
          active: saved.active,
          versionId: saved.versionId ?? null,
          updatedAt: saved.updatedAt,
          backupPath,
          restoreHint: `To restore: n8n_save_workflow with id=${saved.id}, confirm=true, definition=<contents of ${backupPath}>.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonToolResult({
          ok: false,
          error: `save failed: ${msg}`,
          backupPath,
          restoreHint: `Snapshot preserved at ${backupPath}. Server state may or may not have been mutated; fetch n8n_get_workflow to verify.`,
        });
      }
    },
  };
}

function buildSaveBody(
  current: N8nWorkflow,
  proposed: Record<string, unknown>,
): Record<string, unknown> {
  // n8n PUT expects the editable subset. Pass through only the fields
  // that the Public API accepts to avoid 400s from read-only fields.
  const body: Record<string, unknown> = {
    name: (proposed.name as string) ?? current.name,
    nodes: proposed.nodes ?? current.nodes,
    connections: proposed.connections ?? current.connections,
    settings: proposed.settings ?? current.settings ?? {},
  };
  if (proposed.staticData !== undefined) {
    body.staticData = proposed.staticData;
  } else if (current.staticData !== undefined) {
    body.staticData = current.staticData;
  }
  return body;
}

function resolveBackupDir(configured?: string): string {
  const raw = configured?.trim() || "~/.n8n-backups";
  return raw.startsWith("~")
    ? path.join(homedir(), raw.slice(1).replace(/^\/+/, ""))
    : raw;
}

async function writeBackup(
  dir: string,
  wf: N8nWorkflow,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const safeName = String(wf.id).replace(/[^A-Za-z0-9_-]/g, "_");
  const file = path.join(dir, `${safeName}-${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(wf, null, 2), { mode: 0o600 });
  return file;
}
