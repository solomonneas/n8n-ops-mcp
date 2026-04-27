import type { N8nCredentialResponse } from "../client.ts";

/**
 * Strip the `data` field from a credential response before surfacing it to
 * the agent. n8n's OpenAPI marks `data` as `writeOnly` so the field should
 * never appear on GET / DELETE responses, but we redact defensively at the
 * tool layer rather than trusting the upstream API. If a future n8n
 * release regresses and starts echoing `data`, our agents stay safe.
 */
export function stripCredentialData<T extends N8nCredentialResponse>(
  credential: T,
): Omit<T, "data"> {
  if (!credential || typeof credential !== "object") return credential;
  const { data: _drop, ...rest } = credential;
  return rest;
}
