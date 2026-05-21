import { startMcpStdio } from "./mcp.js";

startMcpStdio().catch(err => {
  console.error("[mcp-stdio fatal]", err);
  process.exit(1);
});
