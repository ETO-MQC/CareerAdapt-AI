"use client";

import type { ResumePresentationConfig, ResumeRenderModel, TemplateId } from "@/domain/schemas";
import type { ResumeTemplateDefinition } from "./templates/templateRegistry";
import { TemplateThumbnail } from "./TemplateThumbnail";

export function TemplateCard({
  template,
  model,
  presentationConfig,
  current,
  canApply,
  pending,
  onApply
}: {
  template: ResumeTemplateDefinition;
  model: ResumeRenderModel;
  presentationConfig?: ResumePresentationConfig;
  current: boolean;
  canApply: boolean;
  pending: boolean;
  onApply: (templateId: TemplateId) => void;
}) {
  return (
    <article
      className={`template-card ${current ? "template-card-current" : ""}`}
      data-testid={`template-card-${template.id}`}
      aria-current={current ? "true" : undefined}
      tabIndex={0}
    >
      <TemplateThumbnail model={model} template={template} presentationConfig={presentationConfig} />
      <div className="template-card-body">
        <div className="template-card-heading">
          <div>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
          </div>
          {current ? <span className="template-current-badge">当前使用</span> : null}
        </div>
        <div className="template-meta-row" aria-label={`${template.name} 模板元数据`}>
          <span>{layoutLabel(template.layout)}</span>
          <span>ATS友好：{atsLevelLabel(template.atsLevel)}</span>
          <span>v{template.version}</span>
        </div>
        <div className="template-role-list" aria-label={`${template.name} 适用岗位`}>
          {template.suitableRoles.slice(0, 5).map((role) => (
            <span key={role}>{role}</span>
          ))}
        </div>
        {!template.capabilities.supportsTwoPages ? (
          <p className="template-unsupported-note">当前模板不支持两页策略</p>
        ) : null}
        <button
          type="button"
          className="primary-button compact template-apply-button"
          aria-label={`应用模板：${template.name}`}
          disabled={!canApply || current || pending}
          onClick={() => onApply(template.id)}
        >
          {current ? "当前使用" : pending ? "应用中" : "应用模板"}
        </button>
      </div>
    </article>
  );
}

export function layoutLabel(layout: ResumeTemplateDefinition["layout"]) {
  return layout === "two-column" ? "双栏" : "单栏";
}

export function atsLevelLabel(level: ResumeTemplateDefinition["atsLevel"]) {
  if (level === "high") {
    return "高";
  }
  if (level === "medium") {
    return "中";
  }
  return "视觉优先";
}
