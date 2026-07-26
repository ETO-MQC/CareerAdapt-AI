"use client";

import { Fragment, type ReactNode } from "react";

export function AgentMarkdown({ children }: { children: string }) {
  return <div className="agent-markdown">{renderBlocks(children)}</div>;
}

function renderBlocks(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      nodes.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `heading-${index}`);
      nodes.push(level === 1 ? <h1 key={index}>{content}</h1>
        : level === 2 ? <h2 key={index}>{content}</h2>
          : level === 3 ? <h3 key={index}>{content}</h3>
            : level === 4 ? <h4 key={index}>{content}</h4>
              : level === 5 ? <h5 key={index}>{content}</h5>
                : <h6 key={index}>{content}</h6>);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      nodes.push(<blockquote key={`quote-${index}`}>{inline(quote.join("\n"), `quote-${index}`)}</blockquote>);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ""));
      nodes.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `ul-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ""));
      nodes.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `ol-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }
    if (isTableHeader(lines, index)) {
      const headers = tableCells(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      nodes.push(
        <div className="agent-markdown-table-wrap" key={`table-${index}`}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell, `th-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "", `td-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !/^(#{1,6})\s+|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[index])
      && !isTableHeader(lines, index)
    ) paragraph.push(lines[index++]);
    nodes.push(<p key={`p-${index}`}>{inline(paragraph.join("\n"), `p-${index}`)}</p>);
  }
  return nodes;
}

function inline(source: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^) \n]+\))/g;
  const nodes: ReactNode[] = [];
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > offset) nodes.push(<Fragment key={`${keyPrefix}-text-${offset}`}>{source.slice(offset, match.index)}</Fragment>);
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*") || token.startsWith("_")) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)]\(([^)]+)\)$/.exec(token);
      const href = safeHref(link?.[2] ?? "");
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{link?.[1]}</a>
        : <Fragment key={key}>{link?.[1] ?? token}</Fragment>);
    }
    offset = match.index + token.length;
  }
  if (offset < source.length) nodes.push(<Fragment key={`${keyPrefix}-tail`}>{source.slice(offset)}</Fragment>);
  return nodes;
}

function isTableHeader(lines: string[], index: number) {
  return lines[index]?.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "");
}

function tableCells(line: string) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function safeHref(value: string) {
  try {
    const url = new URL(value, "https://careeradapt.local");
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}
