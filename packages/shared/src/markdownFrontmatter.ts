const LEADING_FRONTMATTER =
  /^\uFEFF?---[ \t]*(?:\r\n|\r|\n)(?:([\s\S]*?)(?:\r\n|\r|\n))?(?:---|\.\.\.)[ \t]*(?=\r\n|\r|\n|$)/;

const LEADING_NEWLINE = /^(?:\r\n|\r|\n)/;

export interface SplitMarkdownFrontmatter {
  /** Trimmed raw YAML inside the leading frontmatter block, or null when absent/empty. */
  readonly frontmatter: string | null;
  /** Document text after the leading frontmatter block (and its closing line break). */
  readonly body: string;
  /** UTF-16 offset of `body` within the original `markdown` string (for source-offset edits). */
  readonly bodyOffset: number;
}

/**
 * Blanks a leading YAML frontmatter block so rendered previews skip it instead
 * of showing a rule and a setext heading. Masked characters become spaces and
 * line breaks stay, so source offsets (task checkbox edits) stay valid.
 */
export function maskMarkdownFrontmatter(markdown: string): string {
  return markdown.replace(LEADING_FRONTMATTER, (block) => block.replace(/[^\r\n]/g, " "));
}

/**
 * Splits a leading YAML frontmatter block from the document body in a single
 * pass, returning `bodyOffset` so callers can map body offsets back to source.
 */
export function splitMarkdownFrontmatter(markdown: string): SplitMarkdownFrontmatter {
  const match = LEADING_FRONTMATTER.exec(markdown);
  if (!match) {
    return { frontmatter: null, body: markdown, bodyOffset: 0 };
  }
  const afterFence = match[0].length;
  const trailingNewline = LEADING_NEWLINE.exec(markdown.slice(afterFence))?.[0].length ?? 0;
  const bodyOffset = afterFence + trailingNewline;
  const raw = match[1]?.trim();
  return {
    frontmatter: raw ? raw : null,
    body: markdown.slice(bodyOffset),
    bodyOffset,
  };
}

/** Wraps raw YAML in a fenced code block using enough backticks to avoid collisions. */
export function formatFrontmatterYamlCodeBlock(yaml: string): string {
  const longestBacktickRun = Math.max(
    2,
    ...[...yaml.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longestBacktickRun + 1);
  return `${fence}yaml\n${yaml}\n${fence}`;
}
