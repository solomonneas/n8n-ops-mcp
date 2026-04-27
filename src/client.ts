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

export interface N8nBatchDeleteResult {
  id: string;
  ok: boolean;
  reason?: "already_deleted" | "server_error" | "error";
  message?: string;
}

export interface N8nBatchRetryResult {
  id: string;
  ok: boolean;
  newExecutionId?: string | number;
  reason?: "not_found" | "not_retryable" | "server_error" | "error";
  message?: string;
}

export interface N8nTag {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Shape returned by POST /credentials and DELETE /credentials/{id}. The
 * `data` field is `writeOnly` per n8n's OpenAPI spec — n8n never echoes it
 * back. We type it as optional+unknown so the runtime defensive-redact has
 * a slot to scrub if a future n8n release regresses, but downstream code
 * must treat any presence of `data` as a leak to suppress.
 */
export interface N8nCredentialResponse {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
  data?: unknown;
  isResolvable?: boolean;
  [key: string]: unknown;
}

export interface N8nCredentialSharedItem {
  id: string;
  name: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface N8nCredentialListItem extends N8nCredentialResponse {
  shared?: N8nCredentialSharedItem[];
}

export interface N8nAuditOptions {
  daysAbandonedWorkflow?: number;
  categories?: Array<
    "credentials" | "database" | "nodes" | "filesystem" | "instance"
  >;
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

  redact(text: string): string {
    return redactKey(text, this.apiKey);
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

  async createWorkflow(body: Record<string, unknown>): Promise<N8nWorkflow> {
    return this.request<N8nWorkflow>(`/api/v1/workflows`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async saveWorkflow(
    id: string,
    body: Record<string, unknown>,
  ): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async activateWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}/activate`, {
      method: "POST",
    });
  }

  async deactivateWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}/deactivate`, {
      method: "POST",
    });
  }

  async archiveWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}/archive`, {
      method: "POST",
    });
  }

  async unarchiveWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}/unarchive`, {
      method: "POST",
    });
  }

  async deleteWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<N8nWorkflow>(`/api/v1/workflows/${id}`, {
      method: "DELETE",
    });
  }

  async executeWorkflow(
    id: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
    return this.request<unknown>(`/api/v1/workflows/${id}/execute`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  async postWebhook(
    webhookPath: string,
    payload: unknown,
    opts: { method?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const path = webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`;
    const url = `${this.baseUrl}${path}`;
    const method = (opts.method ?? "POST").toUpperCase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const hasBody = method !== "GET" && method !== "HEAD";
      const res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(payload ?? {}) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else {
        body = null;
      }
      return { status: res.status, body };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`n8n webhook to ${path} failed: ${redactKey(msg, this.apiKey)}`);
    } finally {
      clearTimeout(timer);
    }
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

  async stopExecution(id: string): Promise<N8nExecution> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid execution id: ${id}`);
    }
    return this.request<N8nExecution>(`/api/v1/executions/${id}/stop`, {
      method: "POST",
    });
  }

  async retryExecution(
    id: string,
    opts: { loadWorkflow?: boolean } = {},
  ): Promise<N8nExecution> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid execution id: ${id}`);
    }
    const init: RequestInit = { method: "POST" };
    if (opts.loadWorkflow !== undefined) {
      init.body = JSON.stringify({ loadWorkflow: opts.loadWorkflow });
    }
    return this.request<N8nExecution>(`/api/v1/executions/${id}/retry`, init);
  }

  async deleteExecution(
    id: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<N8nExecution> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid execution id: ${id}`);
    }
    return this.request<N8nExecution>(`/api/v1/executions/${id}`, {
      method: "DELETE",
      signal: opts.signal,
    });
  }

  async deleteExecutions(
    ids: string[],
    opts: { concurrency?: number } = {},
  ): Promise<N8nBatchDeleteResult[]> {
    for (const id of ids) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error(`Invalid execution id: ${id}`);
      }
    }
    const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 3));
    const results: N8nBatchDeleteResult[] = [];
    const batchCtrl = new AbortController();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (batchCtrl.signal.aborted) return;
        const index = cursor++;
        if (index >= ids.length) return;
        if (batchCtrl.signal.aborted) return;
        const id = ids[index];
        try {
          await this.deleteExecution(id, { signal: batchCtrl.signal });
          results.push({ id, ok: true });
        } catch (err) {
          if (err instanceof N8nApiError && err.status === 404) {
            results.push({ id, ok: true, reason: "already_deleted" });
            continue;
          }
          if (isAbortError(err) && batchCtrl.signal.aborted) {
            // In-flight when batch was aborted by a peer's 5xx. Don't record —
            // intentionally absent from results so the tool can surface
            // skipped = requested - attempted.
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          const redacted = redactKey(msg, this.apiKey);
          if (err instanceof N8nApiError && err.status >= 500) {
            results.push({ id, ok: false, reason: "server_error", message: redacted });
            batchCtrl.abort();
            return;
          }
          results.push({ id, ok: false, reason: "error", message: redacted });
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(ids.length, 1));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  async retryExecutions(
    ids: string[],
    opts: { concurrency?: number; loadWorkflow?: boolean } = {},
  ): Promise<N8nBatchRetryResult[]> {
    for (const id of ids) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error(`Invalid execution id: ${id}`);
      }
    }
    const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 3));
    const results: N8nBatchRetryResult[] = [];
    const batchCtrl = new AbortController();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (batchCtrl.signal.aborted) return;
        const index = cursor++;
        if (index >= ids.length) return;
        if (batchCtrl.signal.aborted) return;
        const id = ids[index];
        try {
          // Mirror deleteExecutions: use request() with the batch signal so
          // an in-flight retry is cancelled when a peer 5xx aborts the batch.
          const init: RequestInit = { method: "POST", signal: batchCtrl.signal };
          if (opts.loadWorkflow !== undefined) {
            init.body = JSON.stringify({ loadWorkflow: opts.loadWorkflow });
          }
          const exec = await this.request<N8nExecution>(
            `/api/v1/executions/${id}/retry`,
            init,
          );
          results.push({
            id,
            ok: true,
            newExecutionId: exec.id,
          });
        } catch (err) {
          if (err instanceof N8nApiError && err.status === 404) {
            results.push({ id, ok: false, reason: "not_found" });
            continue;
          }
          if (isAbortError(err) && batchCtrl.signal.aborted) {
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          const redacted = redactKey(msg, this.apiKey);
          if (err instanceof N8nApiError && err.status === 409) {
            // Mirrors single retry-execution: 409 means n8n refused the
            // retry (e.g. execution is still running). Distinguish from
            // generic errors so batch callers can filter expected
            // refusals from real failures.
            results.push({ id, ok: false, reason: "not_retryable", message: redacted });
            continue;
          }
          if (err instanceof N8nApiError && err.status >= 500) {
            results.push({ id, ok: false, reason: "server_error", message: redacted });
            batchCtrl.abort();
            return;
          }
          results.push({ id, ok: false, reason: "error", message: redacted });
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(ids.length, 1));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  async listTags(params: {
    limit?: number;
    cursor?: string;
  } = {}): Promise<N8nListResponse<N8nTag>> {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    return this.request<N8nListResponse<N8nTag>>(
      `/api/v1/tags${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  async createTag(name: string): Promise<N8nTag> {
    return this.request<N8nTag>(`/api/v1/tags`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async deleteTag(id: string): Promise<N8nTag> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid tag id: ${id}`);
    }
    return this.request<N8nTag>(`/api/v1/tags/${id}`, {
      method: "DELETE",
    });
  }

  async getWorkflowTags(workflowId: string): Promise<N8nTag[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(workflowId)) {
      throw new Error(`Invalid workflow id: ${workflowId}`);
    }
    return this.request<N8nTag[]>(`/api/v1/workflows/${workflowId}/tags`);
  }

  async setWorkflowTags(
    workflowId: string,
    tagIds: string[],
  ): Promise<N8nTag[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(workflowId)) {
      throw new Error(`Invalid workflow id: ${workflowId}`);
    }
    for (const tagId of tagIds) {
      if (!/^[A-Za-z0-9_-]+$/.test(tagId)) {
        throw new Error(`Invalid tag id: ${tagId}`);
      }
    }
    const body = tagIds.map((id) => ({ id }));
    return this.request<N8nTag[]>(`/api/v1/workflows/${workflowId}/tags`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async listCredentials(
    params: { limit?: number; cursor?: string } = {},
  ): Promise<N8nListResponse<N8nCredentialListItem>> {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    return this.request<N8nListResponse<N8nCredentialListItem>>(
      `/api/v1/credentials${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  async getCredentialSchema(
    credentialTypeName: string,
  ): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z0-9._-]+$/.test(credentialTypeName)) {
      throw new Error(`Invalid credential type: ${credentialTypeName}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/v1/credentials/schema/${encodeURIComponent(credentialTypeName)}`,
    );
  }

  /**
   * Create a credential. The `data` field of `body` carries plaintext
   * secrets up to n8n. On any error we deliberately replace the message
   * with a body-free synthetic — n8n's response text (or a JSON.parse
   * error from a malformed 2xx response, which V8 surfaces with a slice
   * of the body in the message) can echo back fragments of the submitted
   * `data`. We do NOT chain the original error as `cause` because the
   * cause's `.message` would carry the leak. Tool layer adds a final
   * defensive layer.
   */
  async createCredential(body: {
    name: string;
    type: string;
    data: Record<string, unknown>;
  }): Promise<N8nCredentialResponse> {
    try {
      return await this.request<N8nCredentialResponse>(`/api/v1/credentials`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err instanceof N8nApiError) {
        throw new N8nApiError(
          err.status,
          err.path,
          `credential create failed (status ${err.status})`,
        );
      }
      // Catch-all for any non-API error class: AbortError, network
      // errors, JSON.parse leaks on malformed 2xx responses, etc.
      // V8's SyntaxError messages include up to ~20 chars of the
      // unparseable text, which on a 200 echo could be the secret.
      throw new Error(
        "credential create failed: non-API error suppressed (body-free)",
      );
    }
  }

  async deleteCredential(id: string): Promise<N8nCredentialResponse> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid credential id: ${id}`);
    }
    return this.request<N8nCredentialResponse>(
      `/api/v1/credentials/${id}`,
      { method: "DELETE" },
    );
  }

  async runAudit(
    options: N8nAuditOptions = {},
  ): Promise<Record<string, unknown>> {
    const body: { additionalOptions?: Record<string, unknown> } = {};
    const extra: Record<string, unknown> = {};
    if (options.daysAbandonedWorkflow !== undefined) {
      extra.daysAbandonedWorkflow = options.daysAbandonedWorkflow;
    }
    if (options.categories && options.categories.length > 0) {
      extra.categories = options.categories;
    }
    if (Object.keys(extra).length > 0) {
      body.additionalOptions = extra;
    }
    return this.request<Record<string, unknown>>(`/api/v1/audit`, {
      method: "POST",
      body: JSON.stringify(body),
    });
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
    const caller = init.signal as AbortSignal | null | undefined;
    let onCallerAbort: (() => void) | undefined;
    if (caller) {
      if (caller.aborted) controller.abort();
      else {
        onCallerAbort = () => controller.abort();
        caller.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    try {
      const { signal: _drop, ...rest } = init;
      const res = await fetch(url, {
        ...rest,
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
      if (isAbortError(err) && caller?.aborted) {
        const e = new Error(`n8n request to ${path} aborted`);
        e.name = "AbortError";
        throw e;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`n8n request to ${path} failed: ${redactKey(msg, this.apiKey)}`);
    } finally {
      clearTimeout(timer);
      if (caller && onCallerAbort) {
        caller.removeEventListener("abort", onCallerAbort);
      }
    }
  }
}

function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("***REDACTED***");
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
