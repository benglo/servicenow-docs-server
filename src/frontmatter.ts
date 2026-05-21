export interface ParsedDoc {
  data: Record<string, string>;
  content: string;
}

/**
 * Tolerant frontmatter parser. ServiceNow's docs frequently have unquoted `:`
 * inside long `description:` lines, which crashes strict YAML. We only need
 * the `title` (and optionally a few other keys), so split on the first `:` per
 * line and ignore everything else.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  if (!raw.startsWith("---")) return { data: {}, content: raw };
  const rest = raw.slice(3);
  const endIdx = rest.indexOf("\n---");
  if (endIdx === -1) return { data: {}, content: raw };
  const header = rest.slice(0, endIdx);
  const body = rest.slice(endIdx + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, content: body };
}
