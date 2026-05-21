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

| HTTP | MCP tool | Purpose |
|---|---|---|
| `GET /releases` | `list_releases` | Branch names available. |
| `GET /index?release=latest` | `get_index` | The `llms.txt` routing index. **Call first.** |
| `GET /topic?path=...&release=latest` | `get_topic` | Raw markdown for one file. |
| `GET /search?q=...&release=latest&limit=10` | `search_docs` | FTS5 fallback when llms.txt doesn't hit. |
| `GET /health` | — | Liveness. |

## Run it

```bash
git clone https://github.com/benglo/servicenow-docs-server.git
cd servicenow-docs-server
docker compose up -d --build
```

First start clones the bare repo + adds all worktrees + builds FTS indexes. Expect a few minutes the first time; subsequent restarts are seconds.

Sanity check:

```powershell
curl http://localhost:8080/health
curl "http://localhost:8080/search?q=glide+record&release=latest&limit=5"
```

## Wiring into Claude Code (MCP)

Copy `.mcp.json.example` to a project's `.mcp.json` (or merge into `~/.claude/.mcp.json` for global). The container must already be running — Claude's MCP client spawns `docker exec -i` to attach a stdio transport on demand.

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

Project-scoped is recommended — only loads the tool definitions into Claude's context when you're in a ServiceNow project.

## Refreshing docs

Restart the container — it `git fetch --all` on boot and rebuilds indexes:

```powershell
docker compose restart servicenow-docs
```

(Or add a host cron / Task Scheduler entry to do it nightly.)

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `REPO_URL` | `https://github.com/ServiceNow/ServiceNowDocs.git` | Source repo. |
| `REPO_ROOT` | `/repo` | Mount point for the named volume. |
| `RELEASES` | `australia,zurich,yokohama,xanadu` | Comma-separated branches to worktree. The repo only keeps the 3 newest GA releases (or 4 if one is in early access), so update this when ServiceNow ships a new release. |
| `DEFAULT_RELEASE` | `australia` | Used when a request omits `release`. Aliases `latest` and `main` map to this. |
| `HTTP_PORT` | `8080` | |

## Local dev (without Docker)

```powershell
npm install
$env:REPO_ROOT = "$PWD\.repo"
npm run dev
```
