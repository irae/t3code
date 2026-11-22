const LEADING_FRONTMATTER =
  /^\uFEFF?---[ \t]*(?:\r\n|\r|\n)(?:([\s\S]*?)(?:\r\n|\r|\n))?(?:---|\.\.\.)[ \t]*(?=\r\n|\r|\n|$)/;

export interface MarkdownFrontmatterEntry {
  readonly key: string;
  readonly value: string;
  readonly items?: ReadonlyArray<string> | undefined;
}

/**
 * Blanks a leading YAML frontmatter block so rendered previews skip it instead
 * of showing a rule and a setext heading. Masked characters become spaces and
 * line breaks stay, so source offsets (task checkbox edits) stay valid.
 */
export function maskMarkdownFrontmatter(markdown: string): string {
  return markdown.replace(LEADING_FRONTMATTER, (block) => block.replace(/[^\r\n]/g, " "));
}

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(value: string): ReadonlyArray<string> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => unquoteScalar(part))
    .filter((part) => part.length > 0);
}

/**
 * Resiliently parses leading YAML frontmatter into key-value pairs without
 * choking on unquoted Cursor globs.
 */
export function parseMarkdownFrontmatterEntries(
  markdown: string,
): ReadonlyArray<MarkdownFrontmatterEntry> | null {
  const match = LEADING_FRONTMATTER.exec(markdown);
  const raw = match?.[1];
  if (!raw || !raw.trim()) return null;

  const lines = raw.split(/\r\n|\r|\n/);
  const entries: MarkdownFrontmatterEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || /^\s*#/.test(line)) {
      index += 1;
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)[ \t]*:(.*)$/.exec(line);
    if (!kv) {
      entries.push({ key: "", value: line.trim() });
      index += 1;
      continue;
    }

    const key = kv[1]!;
    const rest = (kv[2] ?? "").trim();

    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      const blockLines: string[] = [];
      index += 1;
      while (index < lines.length && (/^[ \t]+/.test(lines[index]!) || !lines[index]!.trim())) {
        blockLines.push(lines[index]!.trim());
        index += 1;
      }
      const joined = rest.startsWith(">")
        ? blockLines.filter(Boolean).join(" ")
        : blockLines.join("\n").trim();
      entries.push({ key, value: joined });
      continue;
    }

    if (rest.length === 0) {
      const items: string[] = [];
      const continuationLines: string[] = [];
      index += 1;
      while (index < lines.length && (/^[ \t]+/.test(lines[index]!) || !lines[index]!.trim())) {
        const sub = lines[index]!.trim();
        if (sub.startsWith("- ")) {
          items.push(unquoteScalar(sub.slice(2)));
        } else if (sub.length > 0) {
          continuationLines.push(unquoteScalar(sub));
        }
        index += 1;
      }
      if (items.length > 0) {
        entries.push({ key, value: items.join(", "), items });
      } else {
        entries.push({ key, value: continuationLines.join(" ") });
      }
      continue;
    }

    const inlineItems = parseInlineArray(rest);
    if (inlineItems !== null) {
      entries.push({ key, value: inlineItems.join(", "), items: inlineItems });
    } else {
      entries.push({ key, value: unquoteScalar(rest) });
    }
    index += 1;
  }

  return entries.length > 0 ? entries : null;
}
