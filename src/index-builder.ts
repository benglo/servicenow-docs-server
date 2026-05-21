import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Database from "better-sqlite3";
import { INDEX_DIR, RELEASES } from "./config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { worktreePath } from "./repo.js";

function indexPath(release: string) {
  return join(INDEX_DIR, `${release}.sqlite`);
}

function ensureIndexDir() {
  if (!existsSync(INDEX_DIR)) mkdirSync(INDEX_DIR, { recursive: true });
}

function* walkMarkdown(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkMarkdown(full);
    } else if (st.isFile() && entry.toLowerCase().endsWith(".md")) {
      yield full;
    }
  }
}

function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

export function buildIndex(release: string) {
  ensureIndexDir();
  const tree = worktreePath(release);
  if (!existsSync(tree)) {
    console.warn(`[index] skipping ${release} (worktree missing)`);
    return;
  }
  const dbPath = indexPath(release);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    DROP TABLE IF EXISTS docs;
    CREATE VIRTUAL TABLE docs USING fts5(
      path UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    );
  `);
  const insert = db.prepare("INSERT INTO docs (path, title, body) VALUES (?, ?, ?)");
  const markdownRoot = join(tree, "markdown");
  let count = 0;
  db.exec("BEGIN");
  try {
    for (const file of walkMarkdown(markdownRoot)) {
      const raw = readFileSync(file, "utf8");
      const parsed = parseFrontmatter(raw);
      const rel = relative(tree, file).replace(/\\/g, "/");
      const title = parsed.data.title || extractTitle(parsed.content, rel);
      insert.run(rel, title, parsed.content);
      count++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    throw err;
  }
  db.close();
  console.log(`[index] ${release}: indexed ${count} files`);
}

export function buildAllIndexes() {
  for (const release of RELEASES) buildIndex(release);
}

export function openIndex(release: string): Database.Database | null {
  const path = indexPath(release);
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true, fileMustExist: true });
}
