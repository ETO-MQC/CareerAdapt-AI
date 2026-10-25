import type { TemplateRenderContext } from "../types";

export function fieldAppearanceFor(context: TemplateRenderContext | undefined, itemId: string, fields: string[], text: string, occurrence = 0) {
  const id = itemId.split("::fragment:")[0];
  return (context?.presentationConfig?.fieldAppearances ?? []).filter(entry => entry.itemId === id && fields.includes(entry.field) && entry.occurrence === occurrence && (entry.text === text || /(?:Date|At)$/.test(entry.field) && entry.text.replaceAll("-", ".") === text));
}

export function FormattedText({ text, itemId, fields, context, occurrence = 0 }: { text: string; itemId: string; fields: string[]; context?: TemplateRenderContext; occurrence?: number }) {
  const entries = fieldAppearanceFor(context, itemId, fields, text, occurrence);
  if (entries.some(entry => entry.hidden)) return null;
  const ranges = entries.flatMap(entry => entry.ranges);
  if (!ranges.length) return <>{text}</>;
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.from, range.to])])].filter(value => value >= 0 && value <= text.length).sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const active = ranges.filter(range => range.from <= start && range.to >= end);
    return <span key={start} data-field-format="true" style={{ fontWeight: active.some(range => range.bold) ? 700 : undefined, fontStyle: active.some(range => range.italic) ? "italic" : undefined, textDecoration: active.some(range => range.underline) ? "underline" : undefined }}>{text.slice(start, end)}</span>;
  })}</>;
}
