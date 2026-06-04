import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { BARE_DIR, RELEASES, REPO_ROOT, REPO_URL, WORKTREES_DIR } from "./config.js";

function ensureDirs() {
  for (const dir of [REPO_ROOT, WORKTREES_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

async function ensureBareClone(): Promise<SimpleGit> {
  ensureDirs();
  if (!existsSync(BARE_DIR)) {
    console.log(`[repo] bare clone ${REPO_URL} -> ${BARE_DIR}`);
    await simpleGit(REPO_ROOT).clone(REPO_URL, BARE_DIR, ["--bare"]);
  }
  return simpleGit(BARE_DIR);
}

async function ensureWorktree(git: SimpleGit, release: string) {
  const path = join(WORKTREES_DIR, release);
  if (existsSync(path)) return path;
  console.log(`[repo] worktree add ${release} -> ${path}`);
  try {
    await git.raw(["worktree", "add", path, release]);
  } catch (err) {
    console.warn(`[repo] failed to add worktree for "${release}": ${(err as Error).message}`);
  }
  return path;
}

export async function syncRepo() {
  const git = await ensureBareClone();
  console.log("[repo] fetching all branches");
  await git.fetch(["--all", "--prune"]);
  for (const release of RELEASES) {
    await ensureWorktree(git, release);
  }
}

export function worktreePath(release: string): string {
  return join(WORKTREES_DIR, release);
}

export function readLlmsTxt(release: string): string | null {
  const path = join(worktreePath(release), "llms.txt");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function topicPath(release: string, relPath: string): string {
  const normalised = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (normalised.includes("..")) throw new Error("Path traversal not allowed");
  return join(worktreePath(release), normalised);
}

function sanitiseRelPath(relPath: string): string {
  const normalised = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (normalised.includes("..")) throw new Error("Path traversal not allowed");
  return normalised;
}

/**
 * Run `git diff branchA:path branchB:path` against the bare clone and return
 * the unified diff as plain text. Empty result means the file is identical
 * (or doesn't exist in either branch).
 */
export async function diffTopic(
  path: string,
  releaseA: string,
  releaseB: string
): Promise<string> {
  const safePath = sanitiseRelPath(path);
  const git = simpleGit(BARE_DIR);
  try {
    return await git.raw([
      "diff",
      "--no-color",
      `${releaseA}:${safePath}`,
      `${releaseB}:${safePath}`,
    ]);
  } catch (err) {
    const msg = (err as Error).message;
    // git returns non-zero when one side doesn't exist; surface a helpful note.
    if (msg.includes("does not exist") || msg.includes("exists on disk")) {
      throw new Error(
        `Path ${safePath} does not exist in one or both releases (${releaseA}, ${releaseB})`
      );
    }
    throw err;
  }
}

/**
 * Walk the worktree for `release`, optionally filtered by `prefix` (relative
 * to the release root, e.g. "markdown/api-reference/scripts"). Returns up to
 * `limit` entries (default 200). Useful for tree discovery when search misses.
 */
export function listTopics(
  release: string,
  prefix?: string,
  limit = 200
): { path: string }[] {
  const root = worktreePath(release);
  if (!existsSync(root)) return [];
  const start = prefix ? join(root, sanitiseRelPath(prefix)) : join(root, "markdown");
  if (!existsSync(start)) return [];
  const out: { path: string }[] = [];
  const stack: string[] = [start];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && entry.toLowerCase().endsWith(".md")) {
        out.push({ path: relative(root, full).replace(/\\/g, "/") });
      }
    }
  }
  return out;
}
