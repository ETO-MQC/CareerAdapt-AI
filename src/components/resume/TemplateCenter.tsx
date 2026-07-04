"use client";

import { useMemo, useState } from "react";
import type { ResumePresentationConfig, ResumeRenderModel, TemplateId } from "@/domain/schemas";
import {
  filterResumeTemplates,
  resumeTemplates,
  templateFilterOptions,
  type TemplateFilterKey
} from "./templates/templateRegistry";
import { TemplateCard } from "./TemplateCard";

export function TemplateCenter({
  open,
  model,
  presentationConfig,
  currentTemplateId,
  canApply,
  pendingTemplateId,
  onApply,
  onClose
}: {
  open: boolean;
  model?: ResumeRenderModel;
  presentationConfig?: ResumePresentationConfig;
  currentTemplateId: TemplateId;
  canApply: boolean;
  pendingTemplateId?: TemplateId;
  onApply: (templateId: TemplateId) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<TemplateFilterKey>("all");
  const filteredTemplates = useMemo(() => filterResumeTemplates(filter), [filter]);

  if (!open) {
    return null;
  }

  return (
    <section className="template-center-panel no-print" data-testid="template-center" aria-label="模板中心">
      <div className="template-center-header">
        <div>
          <h2>模板中心</h2>
          <p>{resumeTemplates.length} 套模板 / 当前 {currentTemplateId}</p>
        </div>
        <button type="button" className="secondary-button compact" onClick={onClose} aria-label="关闭模板中心">
          关闭
        </button>
      </div>
      <div className="template-filter-bar" aria-label="模板筛选">
        {templateFilterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`secondary-button compact ${filter === option.key ? "template-filter-active" : ""}`}
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!model ? (
        <p className="template-empty-state">当前分支无法生成模板预览。</p>
      ) : filteredTemplates.length > 0 ? (
        <div className="template-card-grid">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              model={model}
              presentationConfig={presentationConfig}
              current={template.id === currentTemplateId}
              canApply={canApply}
              pending={Boolean(pendingTemplateId)}
              onApply={onApply}
            />
          ))}
        </div>
      ) : (
        <p className="template-empty-state">没有匹配模板。</p>
      )}
    </section>
  );
}
