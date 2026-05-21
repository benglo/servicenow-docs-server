export const REPO_URL = process.env.REPO_URL ?? "https://github.com/ServiceNow/ServiceNowDocs.git";
export const REPO_ROOT = process.env.REPO_ROOT ?? "/repo";
export const BARE_DIR = `${REPO_ROOT}/bare.git`;
export const WORKTREES_DIR = `${REPO_ROOT}/worktrees`;
export const INDEX_DIR = `${REPO_ROOT}/index`;

export const RELEASES = (process.env.RELEASES ?? "australia,zurich,yokohama,xanadu")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export const DEFAULT_RELEASE = process.env.DEFAULT_RELEASE ?? "australia";

export const RELEASE_ALIASES: Record<string, string> = {
  latest: "australia",
  main: "australia",
};

export function resolveReleaseName(input: string): string {
  return RELEASE_ALIASES[input] ?? input;
}

export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
export const HTTP_HOST = process.env.HTTP_HOST ?? "0.0.0.0";

/** Bearer token required on POST/GET /mcp. Empty string disables auth (dev only). */
export const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
