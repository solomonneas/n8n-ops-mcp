import { Type } from "@sinclair/typebox";
import type { N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const CATEGORIES = [
  "credentials",
  "database",
  "nodes",
  "filesystem",
  "instance",
] as const;

const Schema = Type.Object(
  {
    categories: Type.Optional(
      Type.Array(
        Type.Union(CATEGORIES.map((c) => Type.Literal(c))),
        {
          description:
            "Restrict the audit to specific risk categories. Omit for all five (credentials, database, nodes, filesystem, instance). Empty array is the same as omitting.",
        },
      ),
    ),
    daysAbandonedWorkflow: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 365,
        description:
          "Days a workflow must go unexecuted to be flagged as abandoned in the credentials report. n8n's default is 90.",
      }),
    ),
    includeDetails: Type.Optional(
      Type.Boolean({
        description:
          "If true, return the full raw audit body including per-section `location` arrays. Default false: locations are stripped to avoid surfacing credential ids/names + workflow/node ids in agent context unnecessarily. Counts (`sectionCount` / `locationCount`) are always returned regardless. Set true only when you actually need to drill into specific findings.",
      }),
    ),
  },
  { additionalProperties: false },
);

export interface RunAuditOptions {
  categories?: Array<(typeof CATEGORIES)[number]>;
  daysAbandonedWorkflow?: number;
  includeDetails?: boolean;
}

export async function runAudit(
  client: N8nClient,
  opts: RunAuditOptions = {},
): Promise<Record<string, unknown>> {
  const { categories, daysAbandonedWorkflow, includeDetails } = opts;
  {
      const audit = await client.runAudit({
        categories:
          categories && categories.length > 0 ? categories : undefined,
        daysAbandonedWorkflow,
      });

      // Surface a flat report list + section counts so agents can decide what
      // to drill into without reparsing the whole audit object.
      const reports: Array<{
        key: string;
        risk?: unknown;
        sectionCount: number;
        locationCount: number;
      }> = [];
      let totalSections = 0;
      let totalLocations = 0;
      for (const [key, value] of Object.entries(audit)) {
        if (!value || typeof value !== "object") continue;
        const v = value as Record<string, unknown>;
        const sections = Array.isArray(v.sections) ? (v.sections as unknown[]) : [];
        let locs = 0;
        for (const s of sections) {
          if (s && typeof s === "object" && Array.isArray((s as Record<string, unknown>).location)) {
            locs += ((s as Record<string, unknown>).location as unknown[]).length;
          }
        }
        reports.push({
          key,
          risk: (v as { risk?: unknown }).risk,
          sectionCount: sections.length,
          locationCount: locs,
        });
        totalSections += sections.length;
        totalLocations += locs;
      }

      // Default to stripped audit: keep section titles + counts, drop the
      // per-finding `location` arrays. Locations expose credential ids/names
      // (often containing customer/environment identifiers) and node ids
      // that aren't needed for the common "what categories have findings?"
      // triage. Set includeDetails:true to drill in.
      const shouldStrip = includeDetails !== true;
      const auditOut = shouldStrip ? stripLocations(audit) : audit;

      return {
        ok: true,
        action: "audit",
        requestedCategories: categories ?? [...CATEGORIES],
        detailsIncluded: !shouldStrip,
        reportCount: reports.length,
        totalSections,
        totalLocations,
        reports,
        audit: auditOut,
      };
  }
}

export function createRunAuditTool(getClient: () => N8nClient) {
  return {
    name: "n8n_run_audit",
    label: "n8n: run security audit",
    description:
      "Generate n8n's built-in security audit via POST /audit. Returns one risk report per requested category: credentials (unused/abandoned), database (SQL injection-prone expressions), nodes (community/unofficial nodes), filesystem (host fs access), instance (insecure server settings). Each report has `risk`, `sections` (with title/description/recommendation/location). Read-only — n8n only inspects, never mutates. Requires the API user to be an instance admin or owner.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await runAudit(getClient(), rawParams as RunAuditOptions),
      );
    },
  };
}

function stripLocations(audit: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(audit)) {
    if (!value || typeof value !== "object") {
      out[key] = value;
      continue;
    }
    const report = value as Record<string, unknown>;
    const sections = Array.isArray(report.sections)
      ? (report.sections as unknown[]).map((s) => {
          if (!s || typeof s !== "object") return s;
          // Drop `location` only; keep title/description/recommendation so
          // an agent can still see WHAT the finding is, just not the
          // per-resource pointer.
          const { location: _drop, ...rest } = s as Record<string, unknown>;
          return { ...rest, locationCount: Array.isArray(_drop) ? _drop.length : 0 };
        })
      : report.sections;
    out[key] = { ...report, sections };
  }
  return out;
}
