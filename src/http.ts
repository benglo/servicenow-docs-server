import { existsSync, readFileSync } from "node:fs";
import Fastify from "fastify";
import { DEFAULT_RELEASE, HTTP_HOST, HTTP_PORT, MCP_AUTH_TOKEN, RELEASES, resolveReleaseName } from "./config.js";
import { registerMcpHttp } from "./mcp-http.js";
import { readLlmsTxt, topicPath } from "./repo.js";
import { searchDocs } from "./search.js";

function resolveRelease(input: unknown): string {
  const raw = (typeof input === "string" && input) || DEFAULT_RELEASE;
  const r = resolveReleaseName(raw);
  if (!RELEASES.includes(r)) throw new Error(`Unknown release: ${raw}`);
  return r;
}

export async function startHttp() {
  const app = Fastify({ logger: { level: "info" } });

  registerMcpHttp(app);

  app.get("/health", async () => ({
    ok: true,
    releases: RELEASES,
    mcp: { http: "/mcp", auth: MCP_AUTH_TOKEN ? "bearer" : "disabled" },
  }));

  app.get("/releases", async () => ({ releases: RELEASES, default: DEFAULT_RELEASE }));

  app.get<{ Querystring: { release?: string } }>("/index", async (req, reply) => {
    const release = resolveRelease(req.query.release);
    const content = readLlmsTxt(release);
    if (!content) return reply.code(404).send({ error: `llms.txt missing for ${release}` });
    return { release, content };
  });

  app.get<{ Querystring: { release?: string; path?: string } }>("/topic", async (req, reply) => {
    const release = resolveRelease(req.query.release);
    const rel = req.query.path;
    if (!rel) return reply.code(400).send({ error: "path is required" });
    const full = topicPath(release, rel);
    if (!existsSync(full)) return reply.code(404).send({ error: "topic not found" });
    return { release, path: rel, content: readFileSync(full, "utf8") };
  });

  app.get<{ Querystring: { release?: string; q?: string; limit?: string } }>(
    "/search",
    async (req, reply) => {
      const release = resolveRelease(req.query.release);
      const q = req.query.q;
      if (!q) return reply.code(400).send({ error: "q is required" });
      const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
      return { release, query: q, hits: searchDocs(release, q, limit) };
    }
  );

  await app.listen({ host: HTTP_HOST, port: HTTP_PORT });
  console.log(`[http] listening on ${HTTP_HOST}:${HTTP_PORT}`);
  return app;
}
