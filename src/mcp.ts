import { existsSync, readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_RELEASE, RELEASES, resolveReleaseName } from "./config.js";
import { diffTopic, listTopics, readLlmsTxt, topicPath } from "./repo.js";
import { findByMetadata, getReleaseNotes, searchDocs } from "./search.js";

function resolveRelease(input: unknown): string {
  const raw = (typeof input === "string" && input) || DEFAULT_RELEASE;
  const r = resolveReleaseName(raw);
  if (!RELEASES.includes(r)) throw new Error(`Unknown release: ${raw}. Known: ${RELEASES.join(", ")}`);
  return r;
}

const releaseProp = {
  type: "string" as const,
  enum: RELEASES,
  description: `ServiceNow release branch. Default: ${DEFAULT_RELEASE}.`,
};

export function buildMcpServer(): Server {
  const server = new Server(
    { name: "servicenow-docs", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_releases",
        description: "List ServiceNow doc release branches available on this server.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_index",
        description:
          "Return the llms.txt index for a release — the AI-optimised table of contents. Call this first to route to a topic.",
        inputSchema: {
          type: "object",
          properties: { release: releaseProp },
        },
      },
      {
        name: "get_topic",
        description:
          "Return the full markdown for a single topic. `path` is relative to the release root (e.g. `markdown/foo/bar.md`).",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Repo-relative path to the .md file." },
            release: releaseProp,
          },
        },
      },
      {
        name: "search_docs",
        description:
          "Full-text search across a release's markdown. Use when llms.txt doesn't have an obvious match.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search query." },
            release: releaseProp,
            limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
      {
        name: "diff_topic",
        description:
          "Unified `git diff` of the same topic across two release branches — the killer tool for ServiceNow upgrade planning. `path` is repo-relative (e.g. `markdown/api-reference/scripts/c_UsingGlideRecordToQueryTables.md`).",
        inputSchema: {
          type: "object",
          required: ["path", "release_a", "release_b"],
          properties: {
            path: { type: "string", description: "Repo-relative path to the .md file." },
            release_a: { ...releaseProp, description: "Release to diff from (older)." },
            release_b: { ...releaseProp, description: "Release to diff to (newer)." },
          },
        },
      },
      {
        name: "list_topics",
        description:
          "List markdown files in a release, optionally under a path prefix. Use for tree discovery when search misses. Caps at `limit` results (default 200).",
        inputSchema: {
          type: "object",
          properties: {
            release: releaseProp,
            prefix: {
              type: "string",
              description:
                "Optional repo-relative path prefix (e.g. `markdown/api-reference/scripts`). Omit to enumerate the whole `markdown/` tree.",
            },
            limit: { type: "number", minimum: 1, maximum: 1000, default: 200 },
          },
        },
      },
      {
        name: "find_by_metadata",
        description:
          "Exact-match filter by YAML frontmatter fields. Each doc has `product`, `classification`, and `topic_type` keys you can filter by. Useful for queries like 'all REST API concept docs'.",
        inputSchema: {
          type: "object",
          properties: {
            release: releaseProp,
            product: { type: "string", description: "e.g. \"Scripts\", \"REST APIs\", \"ServiceNow Lens\"." },
            classification: { type: "string", description: "e.g. \"scripts\", \"rest-apis\"." },
            topic_type: { type: "string", description: "e.g. \"concept\", \"reference\", \"task\"." },
            limit: { type: "number", minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
      {
        name: "get_release_notes",
        description:
          "Return the canonical release notes page for a release as full markdown. Convenience wrapper — equivalent to searching for 'release notes' and fetching the top hit.",
        inputSchema: {
          type: "object",
          properties: { release: releaseProp },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const { name, arguments: args = {} } = req.params;
    const a = args as Record<string, unknown>;
    try {
      if (name === "list_releases") {
        return textResult(JSON.stringify({ releases: RELEASES, default: DEFAULT_RELEASE }, null, 2));
      }
      if (name === "get_index") {
        const release = resolveRelease(a.release);
        const content = readLlmsTxt(release);
        if (!content) return errorResult(`llms.txt missing for ${release}`);
        return textResult(content);
      }
      if (name === "get_topic") {
        const release = resolveRelease(a.release);
        const rel = String(a.path ?? "");
        if (!rel) return errorResult("path is required");
        const full = topicPath(release, rel);
        if (!existsSync(full)) return errorResult(`topic not found: ${rel}`);
        return textResult(readFileSync(full, "utf8"));
      }
      if (name === "search_docs") {
        const release = resolveRelease(a.release);
        const query = String(a.query ?? "");
        const limit = Math.min(Math.max(Number(a.limit ?? 10) || 10, 1), 50);
        const hits = searchDocs(release, query, limit);
        return textResult(JSON.stringify({ release, query, hits }, null, 2));
      }
      if (name === "diff_topic") {
        const releaseA = resolveRelease(a.release_a);
        const releaseB = resolveRelease(a.release_b);
        const path = String(a.path ?? "");
        if (!path) return errorResult("path is required");
        const diff = await diffTopic(path, releaseA, releaseB);
        if (!diff.trim()) {
          return textResult(`No changes between ${releaseA} and ${releaseB} for ${path}.`);
        }
        return textResult(diff);
      }
      if (name === "list_topics") {
        const release = resolveRelease(a.release);
        const prefix = a.prefix ? String(a.prefix) : undefined;
        const limit = Math.min(Math.max(Number(a.limit ?? 200) || 200, 1), 1000);
        const topics = listTopics(release, prefix, limit);
        return textResult(
          JSON.stringify({ release, prefix: prefix ?? null, count: topics.length, topics }, null, 2)
        );
      }
      if (name === "find_by_metadata") {
        const release = resolveRelease(a.release);
        const limit = Math.min(Math.max(Number(a.limit ?? 50) || 50, 1), 200);
        const hits = findByMetadata(
          release,
          {
            product: a.product ? String(a.product) : undefined,
            classification: a.classification ? String(a.classification) : undefined,
            topic_type: a.topic_type ? String(a.topic_type) : undefined,
          },
          limit
        );
        return textResult(JSON.stringify({ release, count: hits.length, hits }, null, 2));
      }
      if (name === "get_release_notes") {
        const release = resolveRelease(a.release);
        const notes = getReleaseNotes(release);
        if (!notes) return errorResult(`No release notes page found for ${release}.`);
        return textResult(notes.content);
      }
      return errorResult(`Unknown tool: ${name}`);
    } catch (err) {
      return errorResult((err as Error).message);
    }
  });

  return server;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export async function startMcpStdio() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] stdio transport connected");
}
