"use client";

import type { ReactNode } from "react";
import {
  experienceFieldLabels,
  type ResumeFieldCategoryId,
  type StructuredExperienceFields
} from "@/domain/resumeFields/catalog";
import { FieldInput } from "./FieldInput";
import { StringListEditor, AutoTextarea } from "./StringListEditor";
import { FieldFormatting } from "./FieldFormatting";
import { useState } from "react";

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

  const [showDescription, setShowDescription] = useState(Boolean(value.description));
  return (
    <div className="section-fields profile-structured-fields">
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-organization`} formatField={category === "education" ? "school" : "organization"} label={labels.organization} required value={value.organization} onChange={(next) => update("organization", next)} onFocus={onFocus} />
        <FieldInput id={`${idPrefix}-role`} formatField={category === "education" ? "degree" : "role"} label={labels.role} value={category === "education" ? value.degree : value.role} onChange={(next) => update(category === "education" ? "degree" : "role", next)} onFocus={onFocus} />
      </div>
      {category === "education" ? (
        <div className="section-fields-grid-2">
          <FieldInput id={`${idPrefix}-major`} label="专业" value={value.major} onChange={(next) => update("major", next)} onFocus={onFocus} />
          <FieldInput id={`${idPrefix}-location`} label={labels.location} value={value.location} onChange={(next) => update("location", next)} onFocus={onFocus} />
        </div>
      ) : (
        <div className="section-fields-grid-2">
          <FieldInput id={`${idPrefix}-location`} label={labels.location} value={value.location} onChange={(next) => update("location", next)} onFocus={onFocus} />
          {extraField ?? <FieldInput id={`${idPrefix}-department`} label="部门" value={value.department ?? ""} onChange={next => update("department", next)} onFocus={onFocus}/>}
        </div>
      )}
      <div className="section-fields-grid-2">
        <FieldInput id={`${idPrefix}-start`} calendar formatField="startDate" label={labels.startDate} type="text" placeholder="YYYY / YYYY-MM / YYYY-MM-DD" value={value.startDate} onChange={(next) => update("startDate", next)} onFocus={onFocus} />
        <FieldInput
          id={`${idPrefix}-end`}
          calendar formatField={category === "education" && value.current ? "expectedEndDate" : "endDate"}
          label={category === "education" && value.current ? "预计毕业时间" : labels.endDate}
          type="text" placeholder="YYYY / YYYY-MM / YYYY-MM-DD"
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
      {showDescription || value.description ? <div className="field-input-group"><label className="field-input-label" htmlFor={`${idPrefix}-description`}>经历概述</label><FieldFormatting field="description" value={value.description} label="经历概述" onDelete={() => update("description", "")}><AutoTextarea id={`${idPrefix}-description`} label="经历概述" value={value.description} onChange={next => update("description", next)} onFocus={onFocus}/></FieldFormatting></div> : <button type="button" className="field-add-description" onClick={() => setShowDescription(true)}>＋ 添加经历概述</button>}
      <StringListEditor field="highlights" label="描述" idPrefix={`${idPrefix}-highlights`} values={value.highlights} onChange={next => update("highlights", next)} onFocus={onFocus}/>

    </div>
  );
}
