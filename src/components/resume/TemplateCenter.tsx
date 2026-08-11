"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocusedElement = document.activeElement;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []
        ).filter((element) => element.offsetParent !== null);
        if (!focusableElements.length) {
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      if (previouslyFocusedElement instanceof HTMLElement) {
        previouslyFocusedElement.focus();
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="template-center-overlay no-print"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="template-center-panel"
        data-testid="template-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-center-title"
        aria-label="模板中心"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="template-center-header">
          <div>
            <h2 id="template-center-title">模板中心</h2>
            <p>{resumeTemplates.length} 套模板 / 当前 {currentTemplateId}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="secondary-button compact" onClick={onClose} aria-label="关闭模板中心">
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
    </div>,
    document.body
  );
}
