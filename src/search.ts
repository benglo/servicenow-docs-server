import { existsSync, readFileSync } from "node:fs";
import { openIndex } from "./index-builder.js";
import { topicPath } from "./repo.js";

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface MetadataHit {
  path: string;
  title: string;
  product: string;
  classification: string;
  topic_type: string;
  last_updated: string;
}

export interface MetadataCriteria {
  product?: string;
  classification?: string;
  topic_type?: string;
}

function sanitiseQuery(q: string): string {
  const cleaned = q.replace(/["*]/g, " ").trim();
  if (!cleaned) return "";
  const terms = cleaned.split(/\s+/).filter(Boolean);
  return terms.map(t => `"${t}"`).join(" ");
}

export function searchDocs(release: string, query: string, limit = 10): SearchHit[] {
  const db = openIndex(release);
  if (!db) return [];
  const fts = sanitiseQuery(query);
  if (!fts) {
    db.close();
    return [];
  }
  try {
    const rows = db
      .prepare(
        `SELECT path, title,
                snippet(docs, 2, '<<', '>>', ' … ', 12) AS snippet,
                bm25(docs) AS score
         FROM docs
         WHERE docs MATCH ?
         ORDER BY score
         LIMIT ?`
      )
      .all(fts, limit) as SearchHit[];
    return rows;
  } finally {
    db.close();
  }
}

/**
 * Filter docs by exact-match frontmatter fields. Sequential scan of the FTS5
 * table on UNINDEXED columns — fast enough at ~45k rows per release.
 */
export function findByMetadata(
  release: string,
  criteria: MetadataCriteria,
  limit = 50
): MetadataHit[] {
  const db = openIndex(release);
  if (!db) return [];
  const where: string[] = [];
  const params: string[] = [];
  if (criteria.product) {
    where.push("product = ?");
    params.push(criteria.product);
  }
  if (criteria.classification) {
    where.push("classification = ?");
    params.push(criteria.classification);
  }
  if (criteria.topic_type) {
    where.push("topic_type = ?");
    params.push(criteria.topic_type);
  }
  if (!where.length) {
    db.close();
    return [];
  }
  try {
    const sql = `SELECT path, title, product, classification, topic_type, last_updated
                 FROM docs
                 WHERE ${where.join(" AND ")}
                 LIMIT ?`;
    return db.prepare(sql).all(...params, limit) as MetadataHit[];
  } finally {
    db.close();
  }
}

/**
 * Return the canonical release notes page for `release` (as full markdown).
 * Locates it by title/path heuristic against the index. Returns null if no
 * sensible match is found.
 */
export function getReleaseNotes(
  release: string
): { path: string; title: string; content: string } | null {
  const db = openIndex(release);
  if (!db) return null;
  let row: { path: string; title: string } | undefined;
  try {
    row = db
      .prepare(
        `SELECT path, title FROM docs
         WHERE title LIKE ? OR path LIKE ?
         ORDER BY length(path) ASC
         LIMIT 1`
      )
      .get(`%release notes%`, `%release-notes%`) as
      | { path: string; title: string }
      | undefined;
  } finally {
    db.close();
  }
  if (!row) return null;
  const full = topicPath(release, row.path);
  if (!existsSync(full)) return null;
  return { path: row.path, title: row.title, content: readFileSync(full, "utf8") };
}
