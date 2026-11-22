import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon, Code2Icon, ListIcon } from "lucide-react";
import { useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  maskMarkdownFrontmatter,
  parseMarkdownFrontmatter,
  type MarkdownFrontmatter,
  type MarkdownFrontmatterEntry,
} from "@t3tools/shared/markdownFrontmatter";

function renderPropertyValue(entry: MarkdownFrontmatterEntry) {
  const lower = entry.value.toLowerCase();
  if (lower === "true" || lower === "false") {
    return (
      <span
        className={
          lower === "true"
            ? "inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
            : "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground"
        }
      >
        {lower}
      </span>
    );
  }

  const globChips =
    entry.items ??
    (entry.key.toLowerCase() === "globs" && entry.value.length > 0
      ? entry.value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : null);

  if (globChips && globChips.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {globChips.map((chip, idx) => (
          <code
            key={`${chip}-${idx}`}
            className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {chip}
          </code>
        ))}
      </div>
    );
  }

  return <span className="text-foreground break-words">{entry.value}</span>;
}

function FrontmatterPropertiesCard(props: { readonly frontmatter: MarkdownFrontmatter }) {
  const [collapsed, setCollapsed] = useState(false);
  const [showRawYaml, setShowRawYaml] = useState(false);

  return (
    <section
      aria-label="Frontmatter"
      className="mb-5 overflow-hidden rounded-lg border border-border bg-card/50 text-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
          <span>Frontmatter</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
            {props.frontmatter.entries.length}
          </span>
        </button>
        {!collapsed ? (
          <button
            type="button"
            onClick={() => setShowRawYaml((value) => !value)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {showRawYaml ? (
              <>
                <ListIcon className="size-3" />
                <span>Properties</span>
              </>
            ) : (
              <>
                <Code2Icon className="size-3" />
                <span>YAML</span>
              </>
            )}
          </button>
        ) : null}
      </div>
      {collapsed ? null : showRawYaml ? (
        <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-foreground">
          <code>{props.frontmatter.raw}</code>
        </pre>
      ) : (
        <dl className="divide-y divide-border/50">
          {props.frontmatter.entries.map((entry, idx) => (
            <div
              key={`${entry.key}-${idx}`}
              className="grid grid-cols-[minmax(96px,auto)_1fr] items-baseline gap-3 px-3 py-1.5"
            >
              <dt className="font-mono text-[11px] font-medium text-muted-foreground">
                {entry.key}
              </dt>
              <dd className="min-w-0">{renderPropertyValue(entry)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;
  const frontmatter = parseMarkdownFrontmatter(props.text);

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      {frontmatter ? <FrontmatterPropertiesCard frontmatter={frontmatter} /> : null}
      <ChatMarkdown
        text={maskMarkdownFrontmatter(props.text)}
        cwd={props.cwd}
        imageBaseDir={imageBaseDir}
        threadRef={props.threadRef}
        workspaceMutationId={props.workspaceMutationId}
        onTaskListChange={props.onTaskListChange}
      />
    </div>
  );
}
