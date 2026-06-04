import { existsSync, readFileSync } from "node:fs";
import Fastify from "fastify";
import { DEFAULT_RELEASE, HTTP_HOST, HTTP_PORT, MCP_AUTH_TOKEN, RELEASES, resolveReleaseName } from "./config.js";
import { registerMcpHttp } from "./mcp-http.js";
import { diffTopic, listTopics, readLlmsTxt, topicPath } from "./repo.js";
import { findByMetadata, getReleaseNotes, searchDocs } from "./search.js";

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

  app.get<{
    Querystring: { path?: string; release_a?: string; release_b?: string };
  }>("/diff", async (req, reply) => {
    const releaseA = resolveRelease(req.query.release_a);
    const releaseB = resolveRelease(req.query.release_b);
    if (!req.query.path) return reply.code(400).send({ error: "path is required" });
    try {
      const diff = await diffTopic(req.query.path, releaseA, releaseB);
      return { path: req.query.path, release_a: releaseA, release_b: releaseB, diff };
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { release?: string; prefix?: string; limit?: string } }>(
    "/topics",
    async req => {
      const release = resolveRelease(req.query.release);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 1000);
      const topics = listTopics(release, req.query.prefix || undefined, limit);
      return { release, prefix: req.query.prefix ?? null, count: topics.length, topics };
    }
  );

  app.get<{
    Querystring: {
      release?: string;
      product?: string;
      classification?: string;
      topic_type?: string;
      limit?: string;
    };
  }>("/metadata", async req => {
    const release = resolveRelease(req.query.release);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const hits = findByMetadata(
      release,
      {
        product: req.query.product || undefined,
        classification: req.query.classification || undefined,
        topic_type: req.query.topic_type || undefined,
      },
      limit
    );
    return { release, count: hits.length, hits };
  });

  app.get<{ Querystring: { release?: string } }>("/release-notes", async (req, reply) => {
    const release = resolveRelease(req.query.release);
    const notes = getReleaseNotes(release);
    if (!notes) return reply.code(404).send({ error: `No release notes for ${release}` });
    return { release, ...notes };
  });

  await app.listen({ host: HTTP_HOST, port: HTTP_PORT });
  console.log(`[http] listening on ${HTTP_HOST}:${HTTP_PORT}`);
  return app;
}
