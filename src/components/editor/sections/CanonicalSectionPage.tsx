"use client";

import { useMemo, useState } from "react";
import type { CustomFieldValue, ResumeContentItemV2, ResumeItemV2 } from "@/domain/schemas";
import { ResumeItemV2Schema } from "@/domain/schemas";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import { normalizeAwardedAt } from "@/domain/migrations/resumeV2";
import { resumeFieldCatalog, type ResumeFieldDefinition, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { resolveCareerAssetDisplayIdentity } from "@/domain/resumeComposition/CareerAssetDisplayIdentity";
import { FieldOwner } from "../FieldAppearanceContext";
import { FieldFormatting } from "../FieldFormatting";
import { StringListEditor } from "../StringListEditor";
import { DatePicker } from "../DatePicker";
import { useEditorDraftStatus } from "../EditorDraftStatus";
import { ResumeItemTools } from "../ResumeItemTools";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { type SectionNavContext, nextSection, prevSection } from "./types";

type CanonicalSectionPageProps = {
  sectionType: Exclude<ResumeSectionTypeV2, "basics">;
  sectionLabel: string;
  items: ResumeContentItemV2[];
  blocks: ResumeDocumentBlock[];
  selectedItemId?: string;
  onSave: (itemId: string, item: ResumeItemV2, options?: { origin?: "manual" | "auto" }) => Promise<void> | void;
  onAdd?: (item: ResumeItemV2) => Promise<void>;
  onReorder?: (from: string, to: string) => void;
  onSetPresentationVisibility: (itemId: string, visible: boolean) => void;
  onDelete: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onOpenLibrary: () => void;
  nav: SectionNavContext;
};

export function CanonicalSectionPage(props: CanonicalSectionPageProps) {
  const [adding, setAdding] = useState(false);
  const fields = useMemo(
    () => resumeFieldCatalog.filter((field) => field.sectionType === props.sectionType),
    [props.sectionType]
  );
  const prev = prevSection(props.nav.activeSection);
  const next = nextSection(props.nav.activeSection);
  const blocksByItemId = useMemo(
    () => new Map(props.blocks.map((block) => [block.contentItemId, block])),
    [props.blocks]
  );
  const accordionItems = props.items.map((item, index) => {
    const title = itemTitle(item.data, props.sectionLabel, index);
    const block = blocksByItemId.get(item.id);
    const presentationVisible = block?.visible ?? item.visible;
    return {
      id: item.id,
      title,
      subtitle: item.data.sectionType,
      badge: presentationVisible ? undefined : "已隐藏",
      defaultOpen: props.selectedItemId ? props.selectedItemId === item.id : index === 0,
      actions: <ResumeItemTools title={title} visible={presentationVisible} onMoveUp={() => props.onMoveUp(item.id)} onMoveDown={() => props.onMoveDown(item.id)} onVisibility={() => props.onSetPresentationVisibility(item.id, !presentationVisible)} onDelete={() => props.onDelete(item.id)} />,
      content: (
        <FieldOwner itemId={item.id}><CanonicalItemForm
          key={`${item.id}:${JSON.stringify(item.data)}`}
          item={item.data}
          fields={fields}
          visible={presentationVisible}
          visibilityLabel={title}
          onSave={(draft) => props.onSave(item.id, draft)}
          onSetPresentationVisibility={(visible) => props.onSetPresentationVisibility(item.id, visible)}
          onDelete={() => props.onDelete(item.id)}
          onDuplicate={() => props.onDuplicate(item.id)}
          onMoveUp={() => props.onMoveUp(item.id)}
          onMoveDown={() => props.onMoveDown(item.id)}
        /></FieldOwner>
      )
    };
  });

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">项</span>}
      title={props.sectionLabel}
      description={`按字段编辑${props.sectionLabel}，未被模板专门支持的字段仍会保留。隐藏只影响当前预览；删除只移出当前简历，不会删除资料库内容。`}
      saved
      canUndo={props.nav.canUndo}
      canRedo={props.nav.canRedo}
      onUndo={props.nav.onUndo}
      onRedo={props.nav.onRedo}
      hasPrev={Boolean(prev)}
      hasNext={Boolean(next)}
      onPrev={() => prev && props.nav.onNavigate(prev)}
      onNext={() => next && props.nav.onNavigate(next)}
      headerAction={<button type="button" className="section-action-button" onClick={props.onOpenLibrary}>资料库</button>}
    >
      <AccordionList items={accordionItems} onReorder={props.onReorder} emptyHint={`暂无${props.sectionLabel}`} />
      {adding && props.onAdd ? <CanonicalNewItemForm sectionType={props.sectionType} fields={fields} onAdd={props.onAdd} onDone={() => setAdding(false)} /> : props.onAdd ? <button type="button" className="sidebar-add-entry" onClick={() => setAdding(true)}>＋ 添加{props.sectionLabel}</button> : null}
    </SectionShell>
  );
}

function CanonicalNewItemForm(props: { sectionType: Exclude<ResumeSectionTypeV2, "basics">; fields: readonly ResumeFieldDefinition[]; onAdd: (item: ResumeItemV2) => Promise<void>; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEditorDraftStatus(`new:${props.sectionType}`, Object.keys(values).length > 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    const normalizedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? value.map(line => String(line).trim()).filter(Boolean) : value]));
    const result = ResumeItemV2Schema.safeParse({ ...normalizedValues, id: `draft-${props.sectionType}`, sectionType: props.sectionType, customFields: [] });
    if (!result.success) { setError(result.error.issues.map(issue => `${props.fields.find(field => field.id.endsWith(`.${String(issue.path[0])}`))?.label ?? issue.path.join(".")}：请检查必填内容和格式`).join("；")); return; }
    setSaving(true); setError("");
    try { await props.onAdd(normalizeCanonicalFormLists(result.data)); props.onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setSaving(false); }
  }
  return <div className="sidebar-new-item-card" aria-label="新条目草稿"><strong>新条目 · 尚未保存</strong><div className="canonical-item-fields">{props.fields.map(field => {
    const name = field.id.split(".").at(-1)!;
    return <CanonicalField key={field.id} idPrefix={`new-${props.sectionType}`} field={field} value={values[name]} onChange={value => setValues(current => ({ ...current, [name]: value }))} />;
  })}</div>{error ? <p role="alert" className="field-error">{error}</p> : null}<div className="sidebar-draft-actions"><button type="button" className="section-action-button section-action-button-primary" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存并确认"}</button><button type="button" className="section-action-button" disabled={saving} onClick={props.onDone}>取消</button></div></div>;
}

function CanonicalItemForm(props: {
  item: ResumeItemV2;
  fields: readonly ResumeFieldDefinition[];
  visible: boolean;
  visibilityLabel: string;
  onSave: (item: ResumeItemV2) => Promise<void> | void;
  onSetPresentationVisibility: (visible: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [draft, setDraft] = useState<ResumeItemV2>(props.item);
  useEditorDraftStatus(props.item.id, JSON.stringify(draft) !== JSON.stringify(props.item));
  const [saving, setSaving] = useState(false);
  const record = draft as unknown as Record<string, unknown>;

  async function save() {
    setSaving(true);
    try {
      await props.onSave(normalizeCanonicalFormLists(draft));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-fields canonical-item-fields" data-content-item-id={props.item.id}>
      {props.fields.map((field) => {
        const name = field.id.split(".").at(-1)!;
        return (
          <CanonicalField
            key={field.id}
            idPrefix={draft.id}
            field={field}
            value={record[name]}
            onChange={(value) => setDraft((current) => ({ ...current, [name]: value }) as ResumeItemV2)}
          />
        );
      })}
      {draft.customFields.length > 0 ? <div className="canonical-custom-fields" aria-label="自定义字段">
        <strong>自定义字段</strong>
        {draft.customFields.length === 0 ? <p className="field-help-text">暂无自定义字段</p> : null}
        {draft.customFields.map((field, index) => (
          <div className="field-input-group" key={field.id}>
            <label className="field-input-label" htmlFor={`${draft.id}-custom-${field.id}`}>{field.label}</label>
            <input
              id={`${draft.id}-custom-${field.id}`}
              className="field-input"
              value={customFieldText(field)}
              onChange={(event) => setDraft((current) => ({
                ...current,
                customFields: current.customFields.map((candidate, candidateIndex) => candidateIndex === index
                  ? customFieldWithText(candidate, event.target.value)
                  : candidate)
              }) as ResumeItemV2)}
            />
          </div>
        ))}
      </div> : null}
      <div className="experience-item-actions">
        <button type="button" className="section-action-button section-action-button-primary" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
        <details className="sidebar-entry-more"><summary>更多操作</summary><div className="sidebar-entry-menu">
        <button type="button" className="section-action-button" aria-label="上移" onClick={props.onMoveUp}>↑</button>
        <button type="button" className="section-action-button" aria-label="下移" onClick={props.onMoveDown}>↓</button>
        <label className="field-input-checkbox-label field-inline-toggle">
          <input
            type="checkbox"
            aria-label={`在简历中显示：${props.visibilityLabel}`}
            checked={props.visible}
            onChange={(event) => props.onSetPresentationVisibility(event.target.checked)}
          />
          <span>显示</span>
        </label>
        <button type="button" className="section-action-button" onClick={props.onDuplicate}>复制</button>
        <button
          type="button"
          className="section-action-button section-action-button-danger"
          title="只从当前简历移除，不删除个人资料库内容；可用工作栏“撤销”恢复。"
          onClick={props.onDelete}
        >
          删除
        </button>
        </div></details>
      </div>
    </div>
  );
}

export function CanonicalField(props: { idPrefix: string; field: ResumeFieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
  const id = `canonical-${props.idPrefix}-${props.field.id}`;
  if (props.field.valueType === "boolean") {
    return (
      <label className="field-input-checkbox-label">
        <input type="checkbox" checked={Boolean(props.value)} onChange={(event) => props.onChange(event.target.checked)} />
        <span>{props.field.label}</span>
      </label>
    );
  }
  const isList = props.field.valueType === "string_list";
  const rawText = isList ? (Array.isArray(props.value) ? props.value.join("\n") : "") : props.value == null ? "" : String(props.value);
  const text = props.field.id === "awards.awardedAt" ? normalizeAwardedAt(rawText) ?? "" : rawText;
  if (isList) return <StringListEditor field={props.field.id.split(".").at(-1)!} label={props.field.label} idPrefix={id} values={Array.isArray(props.value) ? props.value : []} onChange={props.onChange}/>;
  if (props.field.uiControl === "textarea") {
    return (
      <div className="field-input-group">
        <label className="field-input-label" htmlFor={id}>{props.field.label}</label>
        <FieldFormatting field={props.field.id.split(".").at(-1)!} value={text} label={props.field.label} onDelete={() => props.onChange(undefined)}><textarea id={id} className="field-input field-textarea" rows={isList ? 3 : 4} value={text} onChange={(event) => props.onChange(isList ? event.target.value.split(/\r?\n/) : event.target.value || undefined)} /></FieldFormatting>
        {isList ? <span className="field-help-text">每行一项</span> : null}
      </div>
    );
  }
  return (
    <div className="field-input-group">
      <label className="field-input-label" htmlFor={id}>{props.field.label}</label>
      <FieldFormatting field={props.field.id.split(".").at(-1)!} value={text} label={props.field.label} onDelete={() => props.onChange(undefined)}><div className={props.field.valueType === "date" ? "date-text-input" : undefined}><input
        id={id}
        className="field-input"
        type={props.field.valueType === "number" ? "number" : props.field.valueType === "url" ? "url" : "text"}
        placeholder={props.field.valueType === "date" ? "YYYY / YYYY-MM / YYYY-MM-DD" : undefined}
        step={props.field.valueType === "number" ? "any" : undefined}
        value={text}
        onChange={(event) => props.onChange(props.field.valueType === "number" ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value || undefined)}
      />{props.field.valueType === "date" ? <DatePicker label={props.field.label} value={text} onChange={props.onChange}/> : null}</div></FieldFormatting>
    </div>
  );
}

/** Preserve blank editing lines until save; only committed list values must be nonempty. */
export function normalizeCanonicalFormLists(item: ResumeItemV2): ResumeItemV2 {
  const record = item as unknown as Record<string, unknown>;
  const lists = Object.fromEntries(resumeFieldCatalog
    .filter(field => field.sectionType === item.sectionType && field.valueType === "string_list")
    .flatMap(field => {
      const name = field.id.split(".").at(-1)!;
      const values = record[name] as string[] | undefined;
      return values ? [[name, values.map(value => value.trim()).filter(Boolean)]] : [];
    }));
  return { ...item, ...lists } as ResumeItemV2;
}

function customFieldText(field: CustomFieldValue) {
  return Array.isArray(field.value) ? field.value.join("\n") : String(field.value);
}

function customFieldWithText(field: CustomFieldValue, value: string): CustomFieldValue {
  if (field.valueType === "boolean") return { ...field, value: value === "true" };
  if (field.valueType === "number") return { ...field, value: Number(value) || 0 };
  if (field.valueType === "string_list") return { ...field, value: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
  return { ...field, value };
}

function itemTitle(item: ResumeItemV2, fallback: string, index: number) {
  const identity = resolveCareerAssetDisplayIdentity(item);
  return identity.displayIdentityMissing ? `${fallback} ${index + 1}` : identity.label;
}
