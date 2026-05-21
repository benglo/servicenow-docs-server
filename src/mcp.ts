import { existsSync, readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_RELEASE, RELEASES, resolveReleaseName } from "./config.js";
import { readLlmsTxt, topicPath } from "./repo.js";
import { searchDocs } from "./search.js";

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
