"use client";

import { useState } from "react";
import type { StructuredProjectFields } from "@/domain/resumeFields/catalog";
import { FieldInput } from "./FieldInput";
import { TipTapEditor } from "./TipTapEditor";
import { editorHtmlToExperienceDocument, experienceDocumentToEditorHtml } from "./helpers";

type StructuredProjectFormProps = {
  value: StructuredProjectFields;
  onChange: (value: StructuredProjectFields) => void;
  idPrefix: string;
  onFocus?: () => void;
};

export function StructuredProjectForm({ value, onChange, idPrefix, onFocus }: StructuredProjectFormProps) {
  const update = <Key extends keyof StructuredProjectFields>(key: Key, next: StructuredProjectFields[Key]) => onChange({ ...value, [key]: next });
  const editorDocument = {
    description: value.description,
    highlights: value.highlights,
    outcomes: value.outcomes,
    tools: value.tools,
    background: value.background
  };
  return (
    <div className="section-fields profile-structured-fields structured-project-form">
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-title`} label="项目名称" required value={value.title} onChange={(next) => update("title", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-role`} label="职责 / 角色" value={value.role} onChange={(next) => update("role", next)} onFocus={onFocus} />
      </div>
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-organization`} label="组织 / 项目方" value={value.organization} onChange={(next) => update("organization", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-location`} label="项目地点" value={value.location} onChange={(next) => update("location", next)} onFocus={onFocus} />
      </div>
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-start`} label="开始日期" type="month" value={value.startDate} onChange={(next) => update("startDate", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-end`} label="结束日期" type="month" value={value.endDate} disabled={value.current} onChange={(next) => update("endDate", next)} onFocus={onFocus} />
      </div>
      <label className="field-input-checkbox-label profile-current-toggle">
        <input type="checkbox" checked={value.current} onChange={(event) => update("current", event.target.checked)} />
        <span>仍在进行</span>
      </label>
      <FieldInput id={`${idPrefix}-url`} label="项目链接" type="url" value={value.url} placeholder="https://…" onChange={(next) => update("url", next)} onFocus={onFocus} />
      <TokenEditor idPrefix={`${idPrefix}-tools`} label="技术栈 / 工具" values={value.tools} onChange={(next) => update("tools", next)} onFocus={onFocus} placeholder="输入后按 Enter 添加，例如 React" />
      <TextAreaField id={`${idPrefix}-background`} label="项目背景" value={value.background} onChange={(next) => update("background", next)} onFocus={onFocus} placeholder="只写来源中已有的背景，不需要补充推测。" />
      <div className="experience-description-field">
        <label className="field-input-label">经历内容与成果</label>
        <TipTapEditor
          value={experienceDocumentToEditorHtml(editorDocument)}
          onChange={(html) => {
            const next = editorHtmlToExperienceDocument(html, editorDocument);
            onChange({ ...value, description: next.description, highlights: next.highlights, outcomes: next.outcomes });
          }}
          placeholder="概括经历内容，再用列表写清行动与可验证成果…"
          minRows={7}
          ariaLabel="经历内容与成果"
        />
      </div>
    </div>
  );
}

function TextAreaField({ id, label, value, onChange, onFocus, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; onFocus?: () => void; placeholder?: string }) {
  return (
    <div className="field-input-group structured-project-textarea">
      <label htmlFor={id} className="field-input-label">{label}</label>
      <textarea id={id} className="field-input structured-project-textarea-input" value={value} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value)} onFocus={onFocus} />
    </div>
  );
}

function TokenEditor({ idPrefix, label, values, onChange, onFocus, placeholder }: { idPrefix: string; label: string; values: string[]; onChange: (values: string[]) => void; onFocus?: () => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="structured-token-editor" onFocus={onFocus}>
      <span className="field-input-label">{label}</span>
      <div className="structured-token-editor-entry">
        <input id={`${idPrefix}-input`} className="field-input" aria-label={`添加${label}`} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
        <button type="button" className="section-action-button" onClick={add}>添加</button>
      </div>
      {values.length ? <div className="structured-token-list" aria-label={`${label}列表`}>
        {values.map((value, index) => (
          <span className="structured-token" key={`${value}-${index}`}>
            {value}
            <button type="button" aria-label={`移除${value}`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>×</button>
            <button type="button" aria-label={`上移${value}`} disabled={index === 0} onClick={() => onChange(move(values, index, -1))}>↑</button>
            <button type="button" aria-label={`下移${value}`} disabled={index === values.length - 1} onClick={() => onChange(move(values, index, 1))}>↓</button>
          </span>
        ))}
      </div> : <p className="field-input-hint">尚未添加技术栈；只填写明确出现在资料或来源证据中的工具。</p>}
    </div>
  );
}

function move(values: string[], index: number, delta: number) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= values.length) return values;
  const next = [...values];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}
