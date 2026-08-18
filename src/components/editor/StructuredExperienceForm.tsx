"use client";

import type { ReactNode } from "react";
import {
  experienceFieldLabels,
  type ResumeFieldCategoryId,
  type StructuredExperienceFields
} from "@/domain/resumeFields/catalog";
import { FieldInput } from "./FieldInput";
import { TipTapEditor } from "./TipTapEditor";
import { editorHtmlToExperienceDocument, experienceDocumentToEditorHtml } from "./helpers";

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

  const editorDocument = {
    description: value.description,
    highlights: value.highlights,
    outcomes: value.outcomes ?? [],
    tools: value.tools ?? [],
    background: value.background ?? ""
  };

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
        <FieldInput
          id={`${idPrefix}-end`}
          label={category === "education" && value.current ? "预计毕业时间" : labels.endDate}
          type="month"
          value={category === "education" && value.current ? value.expectedEndDate ?? "" : value.endDate}
          disabled={category !== "education" && value.current}
          onChange={(next) => update(category === "education" && value.current ? "expectedEndDate" : "endDate", next)}
          onFocus={onFocus}
        />
      </div>
      <label className="field-input-checkbox-label profile-current-toggle">
        <input type="checkbox" checked={value.current} onChange={(event) => update("current", event.target.checked)} />
        <span>{category === "education" ? "仍在就读" : "仍在进行"}</span>
      </label>
      {category === "education" ? (
        <FieldInput id={`${idPrefix}-courses`} label="主修课程" value={value.courses} placeholder="用顿号或逗号分隔" onChange={(next) => update("courses", next)} onFocus={onFocus} />
      ) : null}
      <div className="experience-description-field" data-profile-editor="experience-content">
        <label className="field-input-label">{labels.description}</label>
        <TipTapEditor
          value={experienceDocumentToEditorHtml(editorDocument)}
          onChange={(html) => {
            const next = editorHtmlToExperienceDocument(html, editorDocument);
            onChange({
              ...value,
              description: next.description,
              highlights: next.highlights,
              outcomes: next.outcomes,
              tools: next.tools,
              background: next.background
            });
          }}
          placeholder={category === "education" ? "概述教育经历与亮点…" : "写清经历内容、行动与可验证成果…"}
          minRows={5}
        />
      </div>
    </div>
  );
}
