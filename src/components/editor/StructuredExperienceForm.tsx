"use client";

import type { ReactNode } from "react";
import {
  experienceFieldLabels,
  type ResumeFieldCategoryId,
  type StructuredExperienceFields
} from "@/domain/resumeFields/catalog";
import { FieldInput } from "./FieldInput";
import { TipTapEditor } from "./TipTapEditor";
import { htmlToPlainText, plainTextToHtml, highlightsToEditorHtml, editorHtmlToHighlights } from "./helpers";

type StructuredExperienceFormProps = {
  category: Extract<ResumeFieldCategoryId, "education" | "work" | "internship" | "project" | "campus">;
  value: StructuredExperienceFields;
  onChange: (value: StructuredExperienceFields) => void;
  idPrefix: string;
  onFocus?: () => void;
  extraField?: ReactNode;
};

export function StructuredExperienceForm({
  category,
  value,
  onChange,
  idPrefix,
  onFocus,
  extraField
}: StructuredExperienceFormProps) {
  const labels = experienceFieldLabels(category);
  const update = <Key extends keyof StructuredExperienceFields>(key: Key, nextValue: StructuredExperienceFields[Key]) => {
    const next = { ...value, [key]: nextValue };
    if (key === "current" && nextValue) next.endDate = "";
    onChange(next);
  };

  // Get the appropriate highlights label based on category
  const highlightsLabel = category === "project"
    ? "项目成果与说明"
    : category === "education"
      ? "教育亮点"
      : category === "internship"
        ? "实习内容与成果"
        : "工作内容与成果";

  return (
    <div className="section-fields profile-structured-fields">
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-organization`} label={labels.organization} required value={value.organization} onChange={(next) => update("organization", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-role`} label={labels.role} value={category === "education" ? value.degree : value.role} onChange={(next) => update(category === "education" ? "degree" : "role", next)} onFocus={onFocus} />
      </div>
      {category === "education" ? (
        <div className="section-fields-grid-2">
          <FieldInput id={`${idPrefix}-major`} label="专业" value={value.major} onChange={(next) => update("major", next)} onFocus={onFocus} />
          <FieldInput id={`${idPrefix}-location`} label={labels.location} value={value.location} onChange={(next) => update("location", next)} onFocus={onFocus} />
        </div>
      ) : (
        <div className="section-fields-grid-2">
          <FieldInput id={`${idPrefix}-location`} label={labels.location} value={value.location} onChange={(next) => update("location", next)} onFocus={onFocus} />
          {extraField ?? <span />}
        </div>
      )}
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-start`} label={labels.startDate} type="month" value={value.startDate} onChange={(next) => update("startDate", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-end`} label={labels.endDate} type="month" value={value.endDate} disabled={value.current} onChange={(next) => update("endDate", next)} onFocus={onFocus} />
      </div>
      <label className="field-input-checkbox-label profile-current-toggle">
        <input type="checkbox" checked={value.current} onChange={(event) => update("current", event.target.checked)} />
        <span>{category === "education" ? "仍在就读" : "仍在进行"}</span>
      </label>
      {category === "education" ? (
        <FieldInput id={`${idPrefix}-courses`} label="主修课程" value={value.courses} placeholder="用顿号或逗号分隔" onChange={(next) => update("courses", next)} onFocus={onFocus} />
      ) : null}
      <div className="experience-description-field">
        <label className="field-input-label">{labels.description}</label>
        <TipTapEditor
          value={plainTextToHtml(value.description)}
          onChange={(html) => update("description", htmlToPlainText(html))}
          placeholder={category === "education" ? "概述性补充说明…" : "概述性段落说明…"}
          minRows={2}
        />
      </div>
      {value.highlights.length > 0 || (category !== "education" && category !== "work" && category !== "internship") ? (
        <div className="experience-description-field">
          <label className="field-input-label">{highlightsLabel}</label>
          <TipTapEditor
            value={highlightsToEditorHtml(value.highlights)}
            onChange={(html) => update("highlights", editorHtmlToHighlights(html))}
            placeholder="每行一条，写清职责、行动和可验证的结果…"
            minRows={4}
            mode="highlight-list"
          />
        </div>
      ) : null}
    </div>
  );
}
