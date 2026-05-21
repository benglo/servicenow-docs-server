import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp.js";
import { MCP_AUTH_TOKEN } from "./config.js";

function authorised(req: FastifyRequest): boolean {
  if (!MCP_AUTH_TOKEN) return true;
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return false;
  const [scheme, token] = header.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && token === MCP_AUTH_TOKEN;
}

function unauthorised(reply: FastifyReply) {
  reply
    .code(401)
    .header("WWW-Authenticate", 'Bearer realm="servicenow-docs"')
    .send({ error: "Unauthorized" });
}

/**
 * Register a stateless streamable-HTTP MCP endpoint at /mcp on the given
 * fastify instance. Each request spins up a fresh Server + transport — fine
 * for our workload (FTS queries are cheap, no session state to preserve).
 */
export function registerMcpHttp(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorised(req)) return unauthorised(reply);
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    reply.raw.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };

  // streamable-HTTP uses POST for client→server, GET for server→client (SSE).
  app.post("/mcp", handler);
  app.get("/mcp", handler);
  app.delete("/mcp", handler); // session termination
}
