import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "mcp-server": "mcp-server.ts",
    "mcp-bin": "mcp-bin.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  shims: true,
  sourcemap: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
