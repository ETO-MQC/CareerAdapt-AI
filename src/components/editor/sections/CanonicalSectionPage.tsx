"use client";

import { useMemo, useState } from "react";
import type { CustomFieldValue, ResumeContentItemV2, ResumeItemV2 } from "@/domain/schemas";
import { resumeFieldCatalog, type ResumeFieldDefinition, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { type SectionNavContext, nextSection, prevSection } from "./types";

type CanonicalSectionPageProps = {
  sectionType: Exclude<ResumeSectionTypeV2, "basics">;
  sectionLabel: string;
  items: ResumeContentItemV2[];
  selectedItemId?: string;
  onSave: (itemId: string, item: ResumeItemV2, options?: { origin?: "manual" | "auto" }) => Promise<void> | void;
  onSetPresentationVisibility: (itemId: string, visible: boolean) => void;
  onDelete: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onOpenLibrary: () => void;
  nav: SectionNavContext;
};

export function CanonicalSectionPage(props: CanonicalSectionPageProps) {
  const fields = useMemo(
    () => resumeFieldCatalog.filter((field) => field.sectionType === props.sectionType),
    [props.sectionType]
  );
  const prev = prevSection(props.nav.activeSection);
  const next = nextSection(props.nav.activeSection);
  const accordionItems = props.items.map((item, index) => ({
    id: item.id,
    title: itemTitle(item.data, props.sectionLabel, index),
    subtitle: item.data.sectionType,
    badge: item.visible ? undefined : "已隐藏",
    defaultOpen: props.selectedItemId ? props.selectedItemId === item.id : index === 0,
    content: (
      <CanonicalItemForm
        key={`${item.id}:${JSON.stringify(item.data)}`}
        item={item.data}
        fields={fields}
        visible={item.visible}
        onSave={(draft) => props.onSave(item.id, draft)}
        onSetPresentationVisibility={(visible) => props.onSetPresentationVisibility(item.id, visible)}
        onDelete={() => props.onDelete(item.id)}
        onDuplicate={() => props.onDuplicate(item.id)}
        onMoveUp={() => props.onMoveUp(item.id)}
        onMoveDown={() => props.onMoveDown(item.id)}
      />
    )
  }));

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">项</span>}
      title={props.sectionLabel}
      description={`按字段编辑${props.sectionLabel}，未被模板专门支持的字段仍会保留。`}
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
      <AccordionList items={accordionItems} emptyHint={`暂无${props.sectionLabel}`} />
    </SectionShell>
  );
}

function CanonicalItemForm(props: {
  item: ResumeItemV2;
  fields: readonly ResumeFieldDefinition[];
  visible: boolean;
  onSave: (item: ResumeItemV2) => Promise<void> | void;
  onSetPresentationVisibility: (visible: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [draft, setDraft] = useState<ResumeItemV2>(props.item);
  const [saving, setSaving] = useState(false);
  const record = draft as unknown as Record<string, unknown>;

  async function save() {
    setSaving(true);
    try {
      await props.onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-fields canonical-item-fields">
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
      <div className="canonical-custom-fields" aria-label="自定义字段">
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
      </div>
      <div className="experience-item-actions">
        <button type="button" className="section-action-button section-action-button-primary" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
        <button type="button" className="section-action-button" aria-label="上移" onClick={props.onMoveUp}>↑</button>
        <button type="button" className="section-action-button" aria-label="下移" onClick={props.onMoveDown}>↓</button>
        <label className="field-input-checkbox-label field-inline-toggle">
          <input type="checkbox" checked={props.visible} onChange={(event) => props.onSetPresentationVisibility(event.target.checked)} />
          <span>显示</span>
        </label>
        <button type="button" className="section-action-button" onClick={props.onDuplicate}>复制</button>
        <button type="button" className="section-action-button section-action-button-danger" onClick={props.onDelete}>删除</button>
      </div>
    </div>
  );
}

function CanonicalField(props: { idPrefix: string; field: ResumeFieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
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
  const text = isList ? (Array.isArray(props.value) ? props.value.join("\n") : "") : props.value == null ? "" : String(props.value);
  if (props.field.uiControl === "textarea" || isList) {
    return (
      <div className="field-input-group">
        <label className="field-input-label" htmlFor={id}>{props.field.label}</label>
        <textarea id={id} className="field-input field-textarea" rows={isList ? 3 : 4} value={text} onChange={(event) => props.onChange(isList ? event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : event.target.value || undefined)} />
        {isList ? <span className="field-help-text">每行一项</span> : null}
      </div>
    );
  }
  return (
    <div className="field-input-group">
      <label className="field-input-label" htmlFor={id}>{props.field.label}</label>
      <input
        id={id}
        className="field-input"
        type={props.field.valueType === "date" ? "month" : props.field.valueType === "number" ? "number" : props.field.valueType === "url" ? "url" : "text"}
        value={text}
        onChange={(event) => props.onChange(props.field.valueType === "number" ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value || undefined)}
      />
    </div>
  );
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
  const record = item as unknown as Record<string, unknown>;
  return [record.title, record.name, record.organization, record.school, record.language]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined ?? `${fallback} ${index + 1}`;
}
