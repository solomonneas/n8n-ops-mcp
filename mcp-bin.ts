import { serve } from "./mcp-server.ts";

serve().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`n8n-ops-mcp fatal: ${msg}`);
  process.exit(1);
});
