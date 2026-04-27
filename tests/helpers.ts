import { vi } from "vitest";
import type { N8nClient } from "../src/client.ts";

export type FakeClient = {
  [K in keyof N8nClient]: N8nClient[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : N8nClient[K];
};

/**
 * Build a partial N8nClient stub. All methods are vi.fn() by default; pass
 * overrides to seed mockResolvedValue / mockRejectedValue / .mockReturnValue.
 * redact() defaults to identity — individual tests override to prove it ran.
 */
export function makeFakeClient(overrides: Partial<FakeClient> = {}): N8nClient {
  const base = {
    redact: vi.fn((t: string) => t),
    listWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    activateWorkflow: vi.fn(),
    deactivateWorkflow: vi.fn(),
    executeWorkflow: vi.fn(),
    postWebhook: vi.fn(),
    getExecution: vi.fn(),
    listExecutions: vi.fn(),
    stopExecution: vi.fn(),
    retryExecution: vi.fn(),
    deleteExecution: vi.fn(),
    deleteExecutions: vi.fn(),
    archiveWorkflow: vi.fn(),
    unarchiveWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    retryExecutions: vi.fn(),
    listTags: vi.fn(),
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    getWorkflowTags: vi.fn(),
    setWorkflowTags: vi.fn(),
    runAudit: vi.fn(),
    listCredentials: vi.fn(),
    getCredentialSchema: vi.fn(),
    createCredential: vi.fn(),
    deleteCredential: vi.fn(),
  } as unknown as FakeClient;
  return { ...base, ...overrides } as unknown as N8nClient;
}
