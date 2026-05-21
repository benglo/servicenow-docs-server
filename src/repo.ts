import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
