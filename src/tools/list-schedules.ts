import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nWorkflow } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    workflowId: Type.Optional(
      Type.String({
        description:
          "Restrict the scan to a single workflow. Omit to scan recent workflows.",
      }),
    ),
    activeOnly: Type.Optional(
      Type.Boolean({
        description:
          "Only include schedules from active workflows. Default true — inactive schedules don't fire.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 250,
        description:
          "When workflowId is omitted, max workflows to fetch and scan (default 100).",
      }),
    ),
  },
  { additionalProperties: false },
);

const SCHEDULE_NODE_TYPES = new Set<string>([
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.cron",
]);

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface ScheduleEntry {
  workflowId: string;
  workflowName: string;
  active: boolean;
  nodeName: string;
  nodeType: string;
  schedule: string;
  field?: string;
  cronExpression?: string;
  raw: unknown;
}

export interface ListSchedulesOptions {
  workflowId?: string;
  activeOnly?: boolean;
  limit?: number;
}

export async function listSchedules(
  client: N8nClient,
  opts: ListSchedulesOptions = {},
): Promise<Record<string, unknown>> {
  const activeOnly = opts.activeOnly !== false;

  const workflows: N8nWorkflow[] = [];
  if (opts.workflowId) {
    workflows.push(await client.getWorkflow(opts.workflowId));
  } else {
    const list = await client.listWorkflows({
      active: activeOnly ? true : undefined,
      limit: opts.limit ?? 100,
    });
    const defs = await Promise.all(
      list.data.map((w) => client.getWorkflow(w.id)),
    );
    workflows.push(...defs);
  }

  const schedules: ScheduleEntry[] = [];
  for (const wf of workflows) {
    if (activeOnly && !wf.active) continue;
    if (!Array.isArray(wf.nodes)) continue;
    for (const node of wf.nodes) {
      for (const entry of extractSchedules(node, wf)) {
        schedules.push(entry);
      }
    }
  }

  return {
    scannedWorkflows: workflows.length,
    activeOnly,
    count: schedules.length,
    schedules,
  };
}

export function createListSchedulesTool(getClient: () => N8nClient) {
  return {
    name: "n8n_list_schedules",
    label: "n8n: list schedules",
    description:
      "Surface every schedule trigger across workflows so you can answer 'what's running at 3am?' without clicking through the n8n UI. Walks scheduleTrigger and legacy cron nodes, decodes their interval rules into human-readable strings (e.g. 'every 2 hours', 'daily at 03:00', 'cron: 0 */6 * * *'), and returns workflow context + the raw rule for further inspection. Read-only.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonToolResult(
        await listSchedules(getClient(), rawParams as ListSchedulesOptions),
      );
    },
  };
}

function extractSchedules(
  rawNode: unknown,
  wf: N8nWorkflow,
): ScheduleEntry[] {
  if (!rawNode || typeof rawNode !== "object") return [];
  const n = rawNode as Record<string, unknown>;
  const type = String(n.type ?? "");
  if (!SCHEDULE_NODE_TYPES.has(type)) return [];
  const name = typeof n.name === "string" ? n.name : "";
  const params = (n.parameters as Record<string, unknown>) ?? {};

  if (type === "n8n-nodes-base.scheduleTrigger") {
    return decodeScheduleTrigger(params).map((entry) => ({
      workflowId: String(wf.id),
      workflowName: wf.name,
      active: wf.active,
      nodeName: name,
      nodeType: type,
      ...entry,
    }));
  }

  // Legacy `cron` node — single rule per node, simpler shape.
  return decodeLegacyCron(params).map((entry) => ({
    workflowId: String(wf.id),
    workflowName: wf.name,
    active: wf.active,
    nodeName: name,
    nodeType: type,
    ...entry,
  }));
}

interface DecodedSchedule {
  schedule: string;
  field?: string;
  cronExpression?: string;
  raw: unknown;
}

function decodeScheduleTrigger(
  params: Record<string, unknown>,
): DecodedSchedule[] {
  const rule = params.rule as Record<string, unknown> | undefined;
  if (!rule) {
    return [
      {
        schedule: "(no rule configured — uses node default)",
        raw: null,
      },
    ];
  }
  const intervals = rule.interval;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [{ schedule: "(rule has no intervals)", raw: rule }];
  }
  return intervals.map((iv: unknown) => describeInterval(iv));
}

function describeInterval(iv: unknown): DecodedSchedule {
  if (!iv || typeof iv !== "object") {
    return { schedule: "(unparseable interval)", raw: iv };
  }
  const i = iv as Record<string, unknown>;
  const field = typeof i.field === "string" ? i.field : "(unknown field)";

  switch (field) {
    case "cronExpression": {
      const expression =
        typeof i.expression === "string" ? i.expression : "(empty)";
      return {
        field,
        cronExpression: expression,
        schedule: `cron: ${expression}`,
        raw: i,
      };
    }
    case "seconds": {
      const n = numberField(i, "secondsInterval", 1);
      return {
        field,
        schedule: `every ${pluralize(n, "second")}`,
        raw: i,
      };
    }
    case "minutes": {
      const n = numberField(i, "minutesInterval", 1);
      return {
        field,
        schedule: `every ${pluralize(n, "minute")}`,
        raw: i,
      };
    }
    case "hours": {
      const n = numberField(i, "hoursInterval", 1);
      const minute = numberField(i, "triggerAtMinute", 0);
      return {
        field,
        schedule: `every ${pluralize(n, "hour")} at :${pad(minute)}`,
        raw: i,
      };
    }
    case "days": {
      const n = numberField(i, "daysInterval", 1);
      const hour = numberField(i, "triggerAtHour", 0);
      const minute = numberField(i, "triggerAtMinute", 0);
      const cadence =
        n === 1 ? "daily" : `every ${pluralize(n, "day")}`;
      return {
        field,
        schedule: `${cadence} at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    }
    case "weeks": {
      const n = numberField(i, "weeksInterval", 1);
      const hour = numberField(i, "triggerAtHour", 0);
      const minute = numberField(i, "triggerAtMinute", 0);
      const days = arrayField(i, "triggerAtDay")
        .map((d) => DAY_NAMES[Number(d)] ?? `day-${d}`)
        .filter(Boolean);
      const dayPart = days.length > 0 ? ` on ${days.join(", ")}` : "";
      const cadence =
        n === 1 ? "weekly" : `every ${pluralize(n, "week")}`;
      return {
        field,
        schedule: `${cadence}${dayPart} at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    }
    case "months": {
      const n = numberField(i, "monthsInterval", 1);
      const dayOfMonth = numberField(i, "triggerAtDayOfMonth", 1);
      const hour = numberField(i, "triggerAtHour", 0);
      const minute = numberField(i, "triggerAtMinute", 0);
      const cadence =
        n === 1 ? "monthly" : `every ${pluralize(n, "month")}`;
      return {
        field,
        schedule: `${cadence} on day ${dayOfMonth} at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    }
    default:
      return {
        field,
        schedule: `(unsupported field: ${field})`,
        raw: i,
      };
  }
}

function decodeLegacyCron(params: Record<string, unknown>): DecodedSchedule[] {
  const cronTimes = params.triggerTimes as Record<string, unknown> | undefined;
  const items = (cronTimes?.item as unknown[] | undefined) ?? [];
  if (items.length === 0) {
    // Some legacy installs use `cronExpression` directly on params.
    const expr = params.cronExpression;
    if (typeof expr === "string" && expr.trim()) {
      return [
        {
          field: "cronExpression",
          cronExpression: expr,
          schedule: `cron: ${expr}`,
          raw: params,
        },
      ];
    }
    return [{ schedule: "(legacy cron node with no triggerTimes configured)", raw: params }];
  }
  return items.map((item) => describeLegacyCronItem(item));
}

function describeLegacyCronItem(item: unknown): DecodedSchedule {
  if (!item || typeof item !== "object") {
    return { schedule: "(unparseable cron item)", raw: item };
  }
  const i = item as Record<string, unknown>;
  const mode = typeof i.mode === "string" ? i.mode : "everyMinute";
  const hour = numberField(i, "hour", 0);
  const minute = numberField(i, "minute", 0);
  switch (mode) {
    case "everyMinute":
      return { field: "minutes", schedule: "every minute", raw: i };
    case "everyHour":
      return {
        field: "hours",
        schedule: `every hour at :${pad(minute)}`,
        raw: i,
      };
    case "everyDay":
      return {
        field: "days",
        schedule: `daily at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    case "everyWeek": {
      const dow = numberField(i, "weekday", 0);
      return {
        field: "weeks",
        schedule: `weekly on ${DAY_NAMES[dow] ?? `day-${dow}`} at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    }
    case "everyMonth": {
      const dom = numberField(i, "dayOfMonth", 1);
      return {
        field: "months",
        schedule: `monthly on day ${dom} at ${pad(hour)}:${pad(minute)}`,
        raw: i,
      };
    }
    case "custom": {
      const expr =
        typeof i.cronExpression === "string" ? i.cronExpression : "(empty)";
      return {
        field: "cronExpression",
        cronExpression: expr,
        schedule: `cron: ${expr}`,
        raw: i,
      };
    }
    default:
      return {
        field: mode,
        schedule: `(unsupported legacy mode: ${mode})`,
        raw: i,
      };
  }
}

function numberField(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function arrayField(
  obj: Record<string, unknown>,
  key: string,
): unknown[] {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function pluralize(n: number, unit: string): string {
  return n === 1 ? `1 ${unit}` : `${n} ${unit}s`;
}
