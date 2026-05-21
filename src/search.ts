import { openIndex } from "./index-builder.js";

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
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
