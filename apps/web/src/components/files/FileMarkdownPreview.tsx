import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  maskMarkdownFrontmatter,
  parseMarkdownFrontmatterEntries,
} from "@t3tools/shared/markdownFrontmatter";

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
  const frontmatterEntries = parseMarkdownFrontmatterEntries(props.text);

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      {frontmatterEntries ? (
        <div className="mb-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {frontmatterEntries.map((entry, idx) => (
                <tr
                  key={`${entry.key}-${idx}`}
                  className={idx > 0 ? "border-t border-border/70" : undefined}
                >
                  <td className="w-px whitespace-nowrap border-r border-border/70 bg-muted/40 px-3 py-1.5 align-top font-mono font-medium text-muted-foreground">
                    {entry.key}
                  </td>
                  <td className="px-3 py-1.5 align-top text-foreground break-words">
                    {entry.items && entry.items.length > 1 ? (
                      <div className="flex flex-col gap-0.5 font-mono text-[11px] break-all">
                        {entry.items.map((item, itemIdx) => (
                          <span key={`${item}-${itemIdx}`}>{item}</span>
                        ))}
                      </div>
                    ) : (
                      entry.value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
