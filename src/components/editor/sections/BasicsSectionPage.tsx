"use client";

import { useState } from "react";
import { ResumePhotoInput } from "../ResumePhotoInput";
import { GripVertical, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { orderContactDetails, PERSONAL_FIELD_PRESETS, customContactValue, editCustomContactValue } from "@/domain/resumePresentation/contacts";
import { useAnimatedDragSort } from "../useAnimatedDragSort";
import { useEditorDraftStatus } from "../EditorDraftStatus";
import type { CustomFieldValue, CareerProfile, ResumeBranch } from "@/domain/schemas";
import { FieldInput } from "../FieldInput";
import { SectionShell } from "../SectionShell";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type DraftField = "name" | "targetRole" | "email" | "phone" | "location" | "linkedin";

type BasicsSectionPageProps = {
  profile?: CareerProfile;
  branch?: ResumeBranch;
  branchEditable: boolean;
  onSavePhoto: (photo: string | undefined) => Promise<void>;
  photoVisible: boolean;
  supportsPhoto: boolean;
  onPhotoVisibility: (visible: boolean) => void;
  profileFieldError?: string;
  contactOrder?: string[];
  onContactOrder: (order: string[]) => void;
  onSaveCustomFields: (fields: CustomFieldValue[]) => Promise<void>;
  onSaveProfileField: (fieldId: string, value: string) => Promise<boolean> | boolean;
  onSaveBranchBasicsField: (field: "targetRole", value: string) => Promise<boolean> | boolean;
  nav: SectionNavContext;
};

function getFieldValue(profile: CareerProfile | undefined, branch: ResumeBranch | undefined, field: DraftField): string {
  const basics = branch?.resumeBasics;
  switch (field) {
    case "name": return basics?.name ?? profile?.basics.name ?? "";
    case "targetRole": return basics?.targetRole ?? "";
    case "email": return basics?.email ?? profile?.basics.email ?? "";
    case "phone": return basics?.phone ?? profile?.basics.phone ?? "";
    case "location": return basics?.location ?? profile?.basics.location ?? "";
    case "linkedin": return basics?.links?.[0] ?? profile?.basics.links?.[0] ?? "";
  }
}

const FIELD_SAVE_MAP: Record<DraftField, (value: string, props: BasicsSectionPageProps) => Promise<boolean> | boolean> = {
  name: (v, p) => p.onSaveProfileField("profile:name", v),
  targetRole: (v, p) => p.onSaveBranchBasicsField("targetRole", v),
  email: (v, p) => p.onSaveProfileField("profile:email", v),
  phone: (v, p) => p.onSaveProfileField("profile:phone", v),
  location: (v, p) => p.onSaveProfileField("profile:location", v),
  linkedin: (v, p) => p.onSaveProfileField("profile:link:0", v),
};

export function BasicsSectionPage(props: BasicsSectionPageProps) {
  const { profile, branch, profileFieldError, nav } = props;
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);

  const [dirtyValues, setDirtyValues] = useState<Partial<Record<DraftField, string>>>({});

  function handleChange(field: DraftField, value: string) {
    setDirtyValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleBlur(field: DraftField) {
    const dirtyValue = dirtyValues[field];
    if (dirtyValue === undefined) return;
    if (await FIELD_SAVE_MAP[field](dirtyValue, props) === false) return;
    setDirtyValues(previous => { const next = { ...previous }; delete next[field]; return next; });
  }

  function getValue(field: DraftField): string {
    return dirtyValues[field] ?? getFieldValue(profile, branch, field);
  }

  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({});
  const [addingField, setAddingField] = useState(false);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [fieldSaving, setFieldSaving] = useState(false);
  const customFields = branch?.resumeBasics?.customFields ?? [];
  useEditorDraftStatus("basics", Object.keys(dirtyValues).length > 0 || Object.keys(customDrafts).length > 0 || Boolean(fieldLabel));
  const standard: Array<{ id: string; label: string; field: DraftField }> = [
    { id: "phone", label: "手机号", field: "phone" }, { id: "email", label: "邮箱", field: "email" },
    { id: "location", label: "地址", field: "location" }, { id: "link:0", label: "个人网站", field: "linkedin" }
  ];
  const details = [...standard.map(row => ({ id: row.id, label: row.label, value: getValue(row.field) })), ...customFields.map(field => ({ id: `custom:${field.id}`, label: field.label, value: customDrafts[field.id] ?? customContactValue(field.value) }))];
  const rows = orderContactDetails(details, props.contactOrder);
  const sort = useAnimatedDragSort(rows.map(row => row.id), "personal-contact", props.onContactOrder);
  const move = (from: string, to: string) => { const order = rows.map(row => row.id); const source = order.indexOf(from); const target = order.indexOf(to); if (source < 0 || target < 0 || source === target) return; order.splice(source, 1); order.splice(target, 0, from); props.onContactOrder(order); };
  async function saveFields(fields: CustomFieldValue[]) {
    setFieldSaving(true); setFieldError("");
    try { await props.onSaveCustomFields(fields); return true; }
    catch (cause) { setFieldError(cause instanceof Error ? cause.message : "个人信息保存失败，请重试。"); return false; }
    finally { setFieldSaving(false); }
  }
  async function addField(label: string) {
    if (!label.trim()) return;
    const field: CustomFieldValue = { id: crypto.randomUUID(), label: label.trim(), valueType: "string", value: "", order: customFields.length, sensitive: ["性别", "年龄", "出生日期", "政治面貌", "籍贯", "民族"].includes(label.trim()) };
    if (await saveFields([...customFields, field])) { setFieldLabel(""); setAddingField(false); }
  }
  async function saveCustomField(custom: CustomFieldValue) {
    if (customDrafts[custom.id] === undefined) return;
    try {
      const next = editCustomContactValue(custom, customDrafts[custom.id]);
      if (await saveFields(customFields.map(field => field.id === custom.id ? next : field))) setCustomDrafts(previous => { const values = { ...previous }; delete values[custom.id]; return values; });
    } catch (cause) { setFieldError(cause instanceof Error ? cause.message : "字段格式无效。"); }
  }

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">人</span>}
      title="个人信息"
      description="添加您的联系方式和位置，以便雇主可以联系您。"
      saved={Object.keys(dirtyValues).length === 0}
      canUndo={nav.canUndo}
      canRedo={nav.canRedo}
      onUndo={nav.onUndo}
      onRedo={nav.onRedo}
      hasPrev={Boolean(prev)}
      hasNext={Boolean(next)}
      onPrev={() => prev && nav.onNavigate(prev)}
      onNext={() => next && nav.onNavigate(next)}
    >
      <div className="section-fields">
        <div className="basics-identity-with-photo"><div className="basics-identity-fields">
        <FieldInput
          label="全名"
          id="basics-name"
          value={getValue("name")}
          placeholder="张三"
          autoComplete="name"
          onChange={(v) => handleChange("name", v)}
          onBlur={() => handleBlur("name")}
          error={profileFieldError}
        />
        <FieldInput
          label="目标职位"
          id="basics-headline"
          value={getValue("targetRole")}
          placeholder="例如：软件工程师"
          hint="显示在简历顶部，例如：开发工程师。不会改变简历名称。"
          onChange={(v) => handleChange("targetRole", v)}
          onBlur={() => handleBlur("targetRole")}
        />
        </div><div><ResumePhotoInput photo={branch?.resumeBasics?.photo} disabled={!props.branchEditable} onSave={props.onSavePhoto} visibilityControl={<label className="personal-photo-visible"><input type="checkbox" aria-label="显示简历照片" checked={props.photoVisible} disabled={!props.branchEditable || !props.supportsPhoto} onChange={event => props.onPhotoVisibility(event.target.checked)}/><span>显示照片</span></label>} />{!props.supportsPhoto ? <small className="field-help-text">当前预设不显示照片，可切换其他排版预设。</small> : null}</div></div>
        <small className="field-help-text">照片支持 JPG / PNG / WebP，最多 5 MB；上传后直接显示，仅保存到当前简历。</small>
        <div className="personal-fields-heading"><strong>基础信息</strong><div><button type="button" className="section-action-button" onClick={() => props.onContactOrder([...rows.map(row => row.id), `break:${crypto.randomUUID()}`])}>↵ 插入换行</button><button type="button" className="section-action-button" aria-expanded={addingField} onClick={() => setAddingField(value => !value)}><Plus size={14}/> 增加字段</button></div></div>
        {addingField ? <div className="personal-field-picker"><div className="personal-field-presets">{PERSONAL_FIELD_PRESETS.map(label => <button type="button" className="section-action-button" disabled={fieldSaving} key={label} onClick={() => void addField(label)}>{label}</button>)}</div><div className="personal-custom-field"><input className="field-input" aria-label="自定义字段名称" placeholder="自定义字段名称" value={fieldLabel} onChange={event => setFieldLabel(event.target.value)} /><button type="button" className="section-action-button" disabled={fieldSaving || !fieldLabel.trim()} onClick={() => void addField(fieldLabel)}>添加</button></div></div> : null}
        <div ref={node => sort.rootRef(node)} {...sort.rootProps} className="personal-contact-fields">{rows.map((row, index) => {
          const standardField = standard.find(field => field.id === row.id);
          const custom = customFields.find(field => `custom:${field.id}` === row.id);
          return <div className="personal-contact-row" data-contact-id={row.id} key={row.id} {...sort.itemProps(row.id)}>
            <div className="personal-contact-tools"><button type="button" className="sidebar-icon-button" aria-label={`拖动个人信息：${row.label}`} {...sort.handleProps(row.id)} onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const to = rows[index + (event.key === "ArrowUp" ? -1 : 1)]; if (to) move(row.id, to.id); } }}><GripVertical size={14}/></button></div>
            {row.id.startsWith("break:") ? <span className="personal-contact-break">↵ 联系信息换行</span> : <label className="personal-contact-label" htmlFor={standardField ? `basics-${standardField.field === "linkedin" ? "linkedin" : standardField.field === "location" ? "address" : standardField.field}` : `basics-custom-${custom?.id}`}>{row.label}：</label>}
            {!row.id.startsWith("break:") ? <input className="field-input" id={standardField ? `basics-${standardField.field === "linkedin" ? "linkedin" : standardField.field === "location" ? "address" : standardField.field}` : `basics-custom-${custom?.id}`} value={row.value} placeholder={row.label} disabled={fieldSaving} onChange={event => { if (standardField) handleChange(standardField.field, event.target.value); else if (custom) setCustomDrafts(previous => ({ ...previous, [custom.id]: event.target.value })); }} onBlur={() => { if (standardField) void handleBlur(standardField.field); else if (custom) void saveCustomField(custom); }} /> : null}
            <div className="personal-contact-actions"><button type="button" className="sidebar-icon-button" disabled={index === 0} aria-label={`上移个人信息：${row.label}`} onClick={() => move(row.id, rows[index - 1].id)}><ArrowUp size={12}/></button><button type="button" className="sidebar-icon-button" disabled={index === rows.length - 1} aria-label={`下移个人信息：${row.label}`} onClick={() => move(row.id, rows[index + 1].id)}><ArrowDown size={12}/></button></div>
            {custom || row.id.startsWith("break:") ? <button type="button" className="sidebar-icon-button personal-contact-remove" aria-label={`移除个人信息：${row.label}`} disabled={fieldSaving} onClick={() => { if (custom) void saveFields(customFields.filter(field => field.id !== custom.id)); else props.onContactOrder(rows.filter(candidate => candidate.id !== row.id).map(candidate => candidate.id)); }}><X size={13}/></button> : null}
          </div>;
        })}</div>
        {fieldError ? <p className="field-error" role="alert">{fieldError}</p> : null}

      </div>
    </SectionShell>
  );
}
