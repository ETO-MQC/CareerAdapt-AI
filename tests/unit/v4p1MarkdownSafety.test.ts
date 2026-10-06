import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "@/domain/markdownSafety";

describe("V4-P1 stage 5: markdown safe escaping", () => {
  it("escapes raw HTML tags by entity-encoding ampersand and open bracket", () => {
    expect(escapeMarkdownText("<script>alert(1)</script>")).toBe("&lt;script>alert(1)&lt;/script>");
    expect(escapeMarkdownText("a & b")).toBe("a &amp; b");
    expect(escapeMarkdownText("<img src=x onerror=1>")).toBe("&lt;img src=x onerror=1>");
  });

  it("escapes link brackets so markdown links cannot be forged", () => {
    expect(escapeMarkdownText("[点我](https://evil.example)")).toBe("\\[点我\\](https:​//evil.example)");
    expect(escapeMarkdownText("[[inner]]")).toBe("\\[\\[inner\\]\\]");
  });

  it("escapes ATX headings at line starts only", () => {
    expect(escapeMarkdownText("# 标题注入")).toBe("\\# 标题注入");
    expect(escapeMarkdownText("正文第一行\n## 伪标题")).toBe("正文第一行\n\\## 伪标题");
    expect(escapeMarkdownText("行内的 # 不是标题")).toBe("行内的 # 不是标题");
    expect(escapeMarkdownText("a#b")).toBe("a#b");
  });

  it("escapes blockquote markers at line starts", () => {
    expect(escapeMarkdownText("正常\n> 伪引用块")).toBe("正常\n\\> 伪引用块");
    expect(escapeMarkdownText("引用符号在句中 > 无害")).toBe("引用符号在句中 > 无害");
  });

  it("escapes setext underline runs (same marker repeated) at line starts", () => {
    expect(escapeMarkdownText("上一段\n===")).toBe("上一段\n\\===");
    expect(escapeMarkdownText("上一段\n---")).toBe("上一段\n\\---");
    // 单个 = / - 不构成 setext 下划线（参考实现的 \2{2,} 要求同标记字符再出现两次以上）
    expect(escapeMarkdownText("上一段\n=")).toBe("上一段\n=");
    expect(escapeMarkdownText("普通减号 - 在句中")).toBe("普通减号 - 在句中");
  });

  it("neutralizes automatic URL linking with an invisible zero-width space instead of deleting content", () => {
    const escaped = escapeMarkdownText("访问 https://example.com/x 或 www.example.com");
    expect(escaped).toContain("https:\u200b//example.com/x");
    expect(escaped).toContain("www.\u200bexample.com");
    expect(escaped).not.toContain("https://example.com");
    expect(escaped.replace(/\u200b/gu, "")).toBe("访问 https://example.com/x 或 www.example.com");
  });

  it("is idempotent-safe for plain text and keeps useful inline formatting", () => {
    expect(escapeMarkdownText("**加粗** *斜体* `code` 1. 列表")).toBe("**加粗** *斜体* `code` 1. 列表");
    expect(escapeMarkdownText("纯文本")).toBe("纯文本");
    expect(escapeMarkdownText("")).toBe("");
  });

  it("handles CRLF line starts like line starts", () => {
    expect(escapeMarkdownText("第一行\r\n# 伪标题")).toBe("第一行\r\n\\# 伪标题");
  });
});
