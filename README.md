# servicenow-docs-server

Local Docker-hosted server that wraps [ServiceNow/ServiceNowDocs](https://github.com/ServiceNow/ServiceNowDocs) and exposes it through both an **HTTP API** and an **MCP server**. Designed as a leaner, offline-first replacement for Context7 when working on ServiceNow.

## Why

- ServiceNow ships their docs as markdown on GitHub, branched per release (currently `australia` (latest), `zurich`, `yokohama`, `xanadu`) with an AI-friendly `llms.txt` index at the root. `main` is metadata-only — no docs.
- Context7 traverses chunks online — slow and lossy.
- A local container with a bare clone + worktrees per release + SQLite FTS5 gives instant, no-traversal lookups, and stays fresh with `git fetch`.

## Architecture

```
                ┌────────────────────────────────────────────┐
                │  Docker container (servicenow-docs)        │
                │                                            │
  HTTP :8080 ──▶│  fastify  ┐                                │
                │           ├─▶ search / repo / index modules│
  MCP stdio ───▶│  MCP SDK  ┘            │                   │
                │                        ▼                   │
                │           /repo (named volume)             │
                │           ├─ bare.git      (bare clone)    │
                │           ├─ worktrees/    (per release)   │
                │           └─ index/        (FTS5 dbs)      │
                └────────────────────────────────────────────┘
```

## Endpoints / Tools

Eight MCP tools (and matching HTTP endpoints). The first four are core lookup; the last four are workflow extras — `diff_topic` in particular is the killer feature for ServiceNow upgrade planning.

| HTTP | MCP tool | Purpose |
|---|---|---|
| `GET /releases` | `list_releases` | Branch names available. |
| `GET /index?release=latest` | `get_index` | The `llms.txt` routing index. **Call first.** |
| `GET /topic?path=...&release=latest` | `get_topic` | Raw markdown for one file. |
| `GET /search?q=...&release=latest&limit=10` | `search_docs` | bm25-ranked FTS5 search with snippets. |
| `GET /diff?path=...&release_a=...&release_b=...` | `diff_topic` | Unified `git diff` of a topic across two releases — for upgrade planning. |
| `GET /topics?release=...&prefix=...&limit=200` | `list_topics` | Browse the markdown tree under a path prefix. Cap 1000. |
| `GET /metadata?release=...&product=...&topic_type=...&classification=...` | `find_by_metadata` | Exact-match filter on YAML frontmatter fields (e.g. all REST API reference docs). |
| `GET /release-notes?release=...` | `get_release_notes` | Canonical release notes page as full markdown. |
| `GET /health` | — | Liveness. |
| `POST/GET /mcp` | — | Streamable-HTTP MCP transport (bearer-auth). |

## Run it

Prereq: Docker Desktop (macOS/Windows) or Docker Engine (Linux) running.

```bash
git clone https://github.com/benglo/servicenow-docs-server.git
cd servicenow-docs-server
cp .env.example .env       # then edit MCP_AUTH_TOKEN (or leave blank for localhost-only)
docker compose up -d --build
```

First start clones the bare repo + adds all worktrees + builds FTS5 indexes. Expect a few minutes the first time; subsequent restarts are seconds.

Sanity check (works in any shell — bash, zsh, PowerShell 7, cmd):

```bash
curl http://localhost:8080/health
curl "http://localhost:8080/search?q=glide+record&release=latest&limit=5"
```

> **Note for Windows PowerShell 5.x users**: `curl` is an alias for `Invoke-WebRequest` and won't accept the same flags. Use `curl.exe ...` or `Invoke-WebRequest ...` instead. PowerShell 7 (`pwsh`) does not have this alias.

## Wiring into Claude (MCP)

The same `mcpServers` block works for Claude Code (per-project `.mcp.json` or user-global) and Claude Desktop (`claude_desktop_config.json`). The container must already be running — Claude's MCP client spawns `docker exec -i` on demand to attach a stdio transport.

**Default config (Windows / Linux / most installs):**

```json
{
  "mcpServers": {
    "servicenow-docs": {
      "command": "docker",
      "args": ["exec", "-i", "servicenow-docs", "node", "dist/mcp-stdio.js"]
    }
  }
}
```

**macOS Claude Desktop**: GUI apps on macOS don't always inherit the shell's `PATH`, so `docker` can't be found even when it's installed. Use the absolute path instead:

```json
{
  "mcpServers": {
    "servicenow-docs": {
      "command": "/usr/local/bin/docker",       // Intel Mac / Docker Desktop default
      "args": ["exec", "-i", "servicenow-docs", "node", "dist/mcp-stdio.js"]
    }
  }
}
```

On Apple Silicon with Homebrew Docker, use `/opt/homebrew/bin/docker`. Confirm yours with `which docker` in a terminal.

**Config file locations:**

| Client | Path |
|---|---|
| Claude Code (project) | `<your-project>/.mcp.json` |
| Claude Code (user-global) | `~/.claude/.mcp.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |

Project-scoped is recommended for Claude Code — only loads the tool definitions into Claude's context when you're in a ServiceNow project. Claude Desktop is always global.

## Smoke-test the MCP stdio transport

A canned JSON-RPC handshake lives at `test-mcp.jsonl`. Pipe it into the container's stdio entrypoint to verify the server responds correctly.

```bash
# bash / zsh
cat test-mcp.jsonl | docker exec -i servicenow-docs node dist/mcp-stdio.js
```

```powershell
# Windows PowerShell
Get-Content test-mcp.jsonl | docker exec -i servicenow-docs node dist/mcp-stdio.js
```

Expect 5 JSON-RPC responses: initialize, tools/list, and three tool calls.

## Refreshing docs

Restart the container — it `git fetch --all` on boot and rebuilds indexes:

```bash
docker compose restart servicenow-docs
```

(Or add a host cron / launchd / Task Scheduler entry to do it nightly.)

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `REPO_URL` | `https://github.com/ServiceNow/ServiceNowDocs.git` | Source repo. |
| `REPO_ROOT` | `/repo` | Mount point for the named volume. |
| `RELEASES` | `australia,zurich,yokohama,xanadu` | Comma-separated branches to worktree. The repo only keeps the 3 newest GA releases (or 4 if one is in early access), so update this when ServiceNow ships a new release. |
| `DEFAULT_RELEASE` | `australia` | Used when a request omits `release`. Aliases `latest` and `main` map to this. |
| `HTTP_PORT` | `8080` | |
| `MCP_AUTH_TOKEN` | _(empty)_ | Bearer token required on the `/mcp` HTTP endpoint. Empty disables auth — only safe for localhost. Generate via `openssl rand -base64 32` (mac/linux) or the PowerShell snippet in `.env.example`. |

## Local dev (without Docker)

```bash
# bash / zsh
npm install
export REPO_ROOT="$PWD/.repo"
npm run dev
```

```powershell
# Windows PowerShell
npm install
$env:REPO_ROOT = "$PWD\.repo"
npm run dev
```
