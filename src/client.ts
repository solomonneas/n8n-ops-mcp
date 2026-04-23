export interface N8nClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  tags?: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface N8nWorkflow extends N8nWorkflowSummary {
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  pinData?: Record<string, unknown>;
  versionId?: string;
}

export interface N8nListResponse<T> {
  data: T[];
  nextCursor?: string;
}

export type N8nExecutionStatus =
  | "success"
  | "error"
  | "running"
  | "waiting"
  | "canceled"
  | "new"
  | "unknown";

export interface N8nExecutionSummary {
  id: string | number;
  finished: boolean;
  mode: string;
  retryOf?: string | number | null;
  retrySuccessId?: string | number | null;
  status?: N8nExecutionStatus | string;
  workflowId: string;
  startedAt?: string;
  stoppedAt?: string;
  createdAt?: string;
  waitTill?: string | null;
}

export interface N8nExecution extends N8nExecutionSummary {
  data?: {
    resultData?: {
      runData?: Record<string, unknown>;
      error?: unknown;
      lastNodeExecuted?: string;
    };
    executionData?: unknown;
    startData?: unknown;
  };
  workflowData?: {
    id?: string;
    name?: string;
    active?: boolean;
  };
}

export class N8nApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(`n8n ${status} on ${path}: ${message}`);
    this.name = "N8nApiError";
  }
}

export class N8nClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: N8nClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async listWorkflows(params: {
    active?: boolean;
    tags?: string;
    name?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<N8nListResponse<N8nWorkflowSummary>> {
    const qs = new URLSearchParams();
    if (params.active !== undefined) qs.set("active", String(params.active));
    if (params.tags) qs.set("tags", params.tags);
    if (params.name) qs.set("name", params.name);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    return this.request<N8nListResponse<N8nWorkflowSummary>>(
      `/api/v1/workflows${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  async getWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}`);
  }

  async getExecution(
    id: string,
    opts: { includeData?: boolean } = {},
  ): Promise<N8nExecution> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid execution id: ${id}`);
    }
    const qs = new URLSearchParams();
    if (opts.includeData) qs.set("includeData", "true");
    return this.request<N8nExecution>(
      `/api/v1/executions/${id}${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  async listExecutions(params: {
    workflowId?: string;
    status?: string;
    limit?: number;
    cursor?: string;
    includeData?: boolean;
  } = {}): Promise<N8nListResponse<N8nExecutionSummary>> {
    const qs = new URLSearchParams();
    if (params.workflowId) qs.set("workflowId", params.workflowId);
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.includeData) qs.set("includeData", "true");
    return this.request<N8nListResponse<N8nExecutionSummary>>(
      `/api/v1/executions${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "X-N8N-API-KEY": this.apiKey,
          "Accept": "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new N8nApiError(res.status, path, redactKey(text, this.apiKey));
      }
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof N8nApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`n8n request to ${path} failed: ${redactKey(msg, this.apiKey)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("***REDACTED***");
}
