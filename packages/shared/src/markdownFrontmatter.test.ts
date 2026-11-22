import { describe, expect, it } from "vite-plus/test";

import {
  formatFrontmatterYamlCodeBlock,
  maskMarkdownFrontmatter,
  splitMarkdownFrontmatter,
} from "./markdownFrontmatter.ts";

describe("maskMarkdownFrontmatter", () => {
  it("blanks leading frontmatter without moving later offsets", () => {
    const markdown = "---\r\nname: skill\r\n---\r\n# Skill\n- [ ] item\n";
    const masked = maskMarkdownFrontmatter(markdown);

    expect(masked).toBe("   \r\n           \r\n   \r\n# Skill\n- [ ] item\n");
    expect(masked.indexOf("[ ]")).toBe(markdown.indexOf("[ ]"));
  });

  it("handles a byte order mark, CR line endings, and a ... closing fence", () => {
    expect(maskMarkdownFrontmatter("\uFEFF---\na: 1\n---\n# Body")).toBe("    \n    \n   \n# Body");
    expect(maskMarkdownFrontmatter("---\ra: 1\r...\r# Body")).toBe("   \r    \r   \r# Body");
    expect(maskMarkdownFrontmatter("---\n---\n# Body")).toBe("   \n   \n# Body");
  });

  it("leaves unterminated or non-leading fences alone", () => {
    expect(maskMarkdownFrontmatter("---\na: 1\n")).toBe("---\na: 1\n");
    expect(maskMarkdownFrontmatter("# A\n---\nb\n---\n")).toBe("# A\n---\nb\n---\n");
    expect(maskMarkdownFrontmatter("---\na: 1\n----\n")).toBe("---\na: 1\n----\n");
  });
});

describe("splitMarkdownFrontmatter", () => {
  it("splits leading frontmatter and preserves exact source offsets for body edits", () => {
    const markdown =
      "---\r\ndescription: Cursor rule\r\nglobs: **/*.ts\r\nalwaysApply: false\r\n---\r\n# Rule\n- [ ] item\n---\nFooter\n";
    const result = splitMarkdownFrontmatter(markdown);

    expect(result.frontmatter).toBe(
      "description: Cursor rule\r\nglobs: **/*.ts\r\nalwaysApply: false",
    );
    expect(result.body).toBe("# Rule\n- [ ] item\n---\nFooter\n");
    expect(result.bodyOffset + result.body.indexOf("[ ]")).toBe(markdown.indexOf("[ ]"));
  });

  it("strips empty frontmatter without emitting a header block, and leaves non-frontmatter untouched", () => {
    expect(splitMarkdownFrontmatter("---\n---\n# Body")).toEqual({
      frontmatter: null,
      body: "# Body",
      bodyOffset: 8,
    });
    expect(splitMarkdownFrontmatter("\uFEFF---\na: 1\n...\n# Body")).toEqual({
      frontmatter: "a: 1",
      body: "# Body",
      bodyOffset: 14,
    });
    expect(splitMarkdownFrontmatter("# Plain\n---\nRule\n")).toEqual({
      frontmatter: null,
      body: "# Plain\n---\nRule\n",
      bodyOffset: 0,
    });
  });

  it("picks a fence longer than any backtick run inside the YAML", () => {
    expect(formatFrontmatterYamlCodeBlock("description: use ```ts fences")).toBe(
      "````yaml\ndescription: use ```ts fences\n````",
    );
  });
});
