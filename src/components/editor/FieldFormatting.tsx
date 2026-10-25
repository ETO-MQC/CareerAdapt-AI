"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bold, Italic, Underline, Eye, EyeOff, Trash2, Plus } from "lucide-react";
import { useFieldAppearance } from "./FieldAppearanceContext";
import { isFieldMarkActive, toggleFieldMark } from "@/domain/resumePresentation/fieldFormatting";

// Only expose active formatting when the shared renderer has a field mapping.
const formattedFields = new Set(["name", "headline", "targetRole", "email", "phone", "address", "location", "linkedin", "homepage", "school", "organization", "role", "degree", "major", "department", "title", "institution", "authorRole", "issuer", "level", "publisher", "office", "status", "type", "language", "testName", "score", "description", "text", "background", "highlights", "outcomes", "honors", "methods", "url", "startDate", "endDate", "expectedEndDate", "awardedAt", "issuedAt", "publishedAt", "createdAt", "filedAt", "expiresAt", "grantedAt"]);

export function FieldFormatting({ field, value, occurrence = 0, label, children, onDelete, onAdd }: {
  field: string; value: string; occurrence?: number; label: string; children: ReactNode; onDelete?: () => void; onAdd?: () => void;
}) {
  const { store, itemId } = useFieldAppearance();
  const supported = formattedFields.has(field);
  const unavailable = !supported ? "此合成字段暂不支持独立格式与隐藏" : !itemId ? "保存条目后设置格式" : undefined;
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const entry = store?.entries.find(entry => entry.itemId === itemId && entry.field === field && entry.text === value && entry.occurrence === occurrence);
  const full = { bold: isFieldMarkActive(entry?.ranges ?? [], 0, value.length, "bold"), italic: isFieldMarkActive(entry?.ranges ?? [], 0, value.length, "italic"), underline: isFieldMarkActive(entry?.ranges ?? [], 0, value.length, "underline") };
  function format(mark: "bold" | "italic" | "underline") {
    if (!store || !itemId || !value || !supported) return;
    const input = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]),textarea");
    const from = input?.selectionStart ?? 0;
    const to = input?.selectionEnd ?? 0;
    const start = from === to ? 0 : from;
    const end = from === to ? value.length : to;
    store.onChange(entries => {
      const current = entries.find(entry => entry.itemId === itemId && entry.field === field && entry.text === value && entry.occurrence === occurrence);
      const ranges = toggleFieldMark(current?.ranges ?? [], value.length, start, end, mark);
      return [...entries.filter(entry => !(entry.itemId === itemId && entry.field === field && entry.text === value && entry.occurrence === occurrence)), { ...current, itemId, field, text: value, occurrence, ranges }];
    });
  }
  function visibility() {
    if (!store || !itemId || !value || !supported) return;
    store.onChange(entries => {
      const current = entries.find(entry => entry.itemId === itemId && entry.field === field && entry.text === value && entry.occurrence === occurrence);
      return [...entries.filter(entry => !(entry.itemId === itemId && entry.field === field && entry.text === value && entry.occurrence === occurrence)), { ...current, itemId, field, text: value, occurrence, hidden: !current?.hidden, ranges: current?.ranges ?? [] }];
    });
  }
  return <div ref={root} className="field-format-surface" data-field-hidden={entry?.hidden || undefined} data-format-field={field}
    style={{ "--field-font-weight": full.bold ? "700" : "inherit", "--field-font-style": full.italic ? "italic" : "normal", "--field-text-decoration": full.underline ? "underline" : "none" } as CSSProperties}
    onSelectCapture={event => { const input = event.target; if(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) setSelection({from:input.selectionStart??0,to:input.selectionEnd??0}); }}
    onKeyDownCapture={event => { if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase()) && itemId && supported) { event.preventDefault(); format(event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : "underline"); } }}>
    {children}
    {store || onDelete || onAdd ? <div className="field-floating-tools" role="toolbar" aria-label={`字段工具：${label}`} onMouseDown={event => event.preventDefault()}>
      {store ? <>{([['bold', Bold, '加粗'], ['italic', Italic, '斜体'], ['underline', Underline, '下划线']] as const).map(([mark, Icon, text]) => <button key={mark} type="button" aria-label={`${text}：${label}`} aria-pressed={isFieldMarkActive(entry?.ranges ?? [], selection.from === selection.to ? 0 : selection.from, selection.from === selection.to ? value.length : selection.to, mark)} disabled={!value || !itemId || !supported} title={unavailable} onClick={() => format(mark)}><Icon size={13}/></button>)}<span className="field-tools-divider"/>
        <button type="button" disabled={!value || !itemId || !supported} title={unavailable} aria-label={`${entry?.hidden ? "显示" : "隐藏"}字段：${label}`} onClick={visibility}>{entry?.hidden ? <EyeOff size={14}/> : <Eye size={14}/>}</button></> : null}
      {onAdd ? <button type="button" aria-label={`新增一条：${label}`} onClick={onAdd}><Plus size={14}/></button> : null}
      {onDelete ? <button type="button" aria-label={`删除字段内容：${label}`} onClick={onDelete}><Trash2 size={14}/></button> : null}
    </div> : null}
  </div>;
}
