import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { formatMarkdownWithFrontmatterCodeBlock } from "@t3tools/shared/markdownFrontmatter";

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
  const { text, bodyOffset, offsetDelta } = formatMarkdownWithFrontmatterCodeBlock(props.text);
  const onTaskListChange = props.onTaskListChange
    ? ({ markerOffset, checked }: { readonly markerOffset: number; readonly checked: boolean }) => {
        const sourceOffset = markerOffset + offsetDelta;
        if (sourceOffset < bodyOffset) return;
        props.onTaskListChange?.({ markerOffset: sourceOffset, checked });
      }
    : undefined;

  return (
    <ChatMarkdown
      text={text}
      cwd={props.cwd}
      imageBaseDir={imageBaseDir}
      threadRef={props.threadRef}
      workspaceMutationId={props.workspaceMutationId}
      className="mx-auto max-w-4xl px-6 py-5"
      onTaskListChange={onTaskListChange}
    />
  );
}
