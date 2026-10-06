/**
 * V4-P1 阶段 5：Markdown 安全转义。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo —
 * agent/presentation/mock_interview.py 的 _escape_markdown_text。
 *
 * 目标（与参考实现一致）：允许加粗/斜体/行内代码/列表等有用的行内格式，
 * 但让模型输出的文本无法伪造标题、引用块、链接或原始 HTML。转义是幂等的
 * 展示前步骤，不改变语义内容；URL 通过插入零宽空格阻断 markdown 自动
 * 链接化，而不是删除内容。
 */

// /m 让 ^ 与 $ 与 Python (?m) 一样按行锚定；其余结构逐条对应参考实现。
const MARKDOWN_LINK_BRACKET = /([[\]])/gu;
const MARKDOWN_HEADING_PREFIX = /^([ \t]*)(#)(?=#*\s|$)/gmu;
const MARKDOWN_BLOCKQUOTE_PREFIX = /^([ \t]*)(>)/gmu;
const MARKDOWN_SETEXT_HEADING = /^([ \t]*)([=-])(?=\2{2,}[ \t]*$)/gmu;
const MARKDOWN_HTTP_URL = /\b(https?):(?=\/\/)/giu;
const MARKDOWN_WWW_URL = /\b(www\.)(?=[^\s]+)/giu;

/** 零宽空格：打断 markdown 链接/自动 URL 识别，视觉上不可见。 */
const ZERO_WIDTH_SPACE = "\u200b";

export function escapeMarkdownText(value: string): string {
  const escapedHtml = value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;");
  const escapedLinks = escapedHtml.replace(MARKDOWN_LINK_BRACKET, "\\$1");
  const escapedHeadings = escapedLinks.replace(MARKDOWN_HEADING_PREFIX, "$1\\$2");
  const escapedQuotes = escapedHeadings.replace(MARKDOWN_BLOCKQUOTE_PREFIX, "$1\\$2");
  const escapedSetext = escapedQuotes.replace(MARKDOWN_SETEXT_HEADING, "$1\\$2");
  const escapedUrls = escapedSetext.replace(MARKDOWN_HTTP_URL, "$1:" + ZERO_WIDTH_SPACE);
  return escapedUrls.replace(MARKDOWN_WWW_URL, "$1" + ZERO_WIDTH_SPACE);
}
