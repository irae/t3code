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

export interface MarkdownWithFrontmatterCodeBlock {
  /** Single Markdown string with leading frontmatter converted to a `yaml` fenced block. */
  readonly text: string;
  /** UTF-16 offset where the body begins in the original `markdown` string. */
  readonly bodyOffset: number;
  /** Add to any offset in `text` (within the body) to obtain the offset in original `markdown`. */
  readonly offsetDelta: number;
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

/**
 * Converts a leading YAML frontmatter block into a `yaml` fenced code block
 * within a single Markdown string, returning `offsetDelta` so body offsets
 * (such as interactive task-list checkboxes) map back to the original source.
 */
export function formatMarkdownWithFrontmatterCodeBlock(
  markdown: string,
): MarkdownWithFrontmatterCodeBlock {
  const { frontmatter, body, bodyOffset } = splitMarkdownFrontmatter(markdown);
  if (!frontmatter) {
    return { text: body, bodyOffset, offsetDelta: bodyOffset };
  }
  const block = formatFrontmatterYamlCodeBlock(frontmatter);
  if (!body) {
    return { text: block, bodyOffset, offsetDelta: bodyOffset - block.length };
  }
  const prefix = `${block}\n\n`;
  return {
    text: `${prefix}${body}`,
    bodyOffset,
    offsetDelta: bodyOffset - prefix.length,
  };
}
