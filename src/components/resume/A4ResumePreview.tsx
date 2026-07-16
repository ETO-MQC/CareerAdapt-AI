"use client";

import { useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { ResumePaginationPlan, ResumePresentationConfig, ResumeRenderModel } from "@/domain/schemas";
import { resumeTemplateStyleVars, type TemplateDefinition } from "./templates/templateRegistry";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import { paginateResumeRenderModel } from "@/services/export/pagination";

export type ResumeStudioEditorProps = {
  enabled: boolean;
  selectedItemId?: string;
  editingItemId?: string;
  selectedBlock?: ResumeDocumentBlock;
  selectedProfileFieldId?: string;
  editingProfileFieldId?: string;
  selectedProfileFieldLabel?: string;
  selectedSectionTitleId?: string;
  editingSectionTitleId?: string;
  selectedSectionTitleLabel?: string;
  draftText: string;
  profileDraftText?: string;
  sectionTitleDraftText?: string;
  error?: string;
  profileError?: string;
  sectionTitleError?: string;
  pending: boolean;
  onSelect: (itemId: string) => void;
  onStartEdit: (itemId: string) => void;
  onDraftTextChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onSelectProfileField?: (fieldId: string, currentText: string) => void;
  onStartProfileFieldEdit?: (fieldId: string, currentText: string) => void;
  onProfileDraftTextChange?: (text: string) => void;
  onSaveProfileField?: () => void;
  onCancelProfileField?: () => void;
  onSelectSectionTitle?: (fieldId: string, currentText: string) => void;
  onStartSectionTitleEdit?: (fieldId: string, currentText: string) => void;
  onSectionTitleDraftTextChange?: (text: string) => void;
  onSaveSectionTitle?: () => void;
  onCancelSectionTitle?: () => void;
  onMoveUp?: (itemId: string) => void;
  onMoveDown?: (itemId: string) => void;
  onHide?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;
};

export function A4ResumePreview({
  model,
  template,
  pageRef,
  paginationPlan,
  presentationConfig,
  zoom = 1,
  editor
}: {
  model: ResumeRenderModel;
  template: TemplateDefinition;
  pageRef: RefObject<HTMLElement | null>;
  paginationPlan?: ResumePaginationPlan;
  presentationConfig?: ResumePresentationConfig;
  zoom?: number;
  editor?: ResumeStudioEditorProps;
}) {
  const [overlayRect, setOverlayRect] = useState<{ left: number; top: number; width: number } | undefined>();
  const pageModels = paginateResumeRenderModel(model, paginationPlan);
  // Show all pages instead of limiting to requestedMaxPages
  // This allows users to see and manage content across multiple pages
  const visiblePageModels = pageModels;
  const pageCount = Math.max(1, visiblePageModels.length);

  function findSourceNode(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return undefined;
    }
    return target.closest<HTMLElement>("[data-source-item-id]");
  }

  function isProfileFieldId(itemId: string) {
    return itemId.startsWith("profile:");
  }

  function isSectionTitleId(itemId: string) {
    return itemId.startsWith("section-title:");
  }

  function positionOverlay(sourceNode: HTMLElement, pageNode: HTMLElement) {
    const sourceRect = sourceNode.getBoundingClientRect();
    const pageRect = pageNode.getBoundingClientRect();
    setOverlayRect({
      left: Math.max(8, sourceRect.left - pageRect.left),
      top: Math.max(8, sourceRect.top - pageRect.top),
      width: Math.min(Math.max(sourceRect.width, 220), pageRect.width - 24)
    });
  }

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    const sourceNode = findSourceNode(event.target);
    const itemId = sourceNode?.dataset.sourceItemId;
    if (itemId) {
      positionOverlay(sourceNode, event.currentTarget);
      if (isProfileFieldId(itemId) && editor.onSelectProfileField) {
        editor.onSelectProfileField(itemId, sourceNode.textContent ?? "");
      } else if (isSectionTitleId(itemId) && editor.onSelectSectionTitle) {
        editor.onSelectSectionTitle(itemId, sourceNode.textContent ?? "");
      } else {
        editor.onSelect(itemId);
      }
    }
  }

  function handleDoubleClick(event: MouseEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    const sourceNode = findSourceNode(event.target);
    const itemId = sourceNode?.dataset.sourceItemId;
    if (itemId) {
      positionOverlay(sourceNode, event.currentTarget);
      if (isProfileFieldId(itemId) && editor.onSelectProfileField && editor.onStartProfileFieldEdit) {
        const currentText = sourceNode.textContent ?? "";
        editor.onSelectProfileField(itemId, currentText);
        editor.onStartProfileFieldEdit(itemId, currentText);
      } else if (isSectionTitleId(itemId) && editor.onSelectSectionTitle && editor.onStartSectionTitleEdit) {
        const currentText = sourceNode.textContent ?? "";
        editor.onSelectSectionTitle(itemId, currentText);
        editor.onStartSectionTitleEdit(itemId, currentText);
      } else {
        editor.onSelect(itemId);
        editor.onStartEdit(itemId);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    if (event.nativeEvent.isComposing) {
      return;
    }
    if ((event.key === "Enter" || event.key === "F2") && !editor.editingItemId && editor.selectedItemId) {
      event.preventDefault();
      editor.onStartEdit(editor.selectedItemId);
    }
    if ((event.key === "Enter" || event.key === "F2") && !editor.editingProfileFieldId && editor.selectedProfileFieldId && editor.onStartProfileFieldEdit) {
      event.preventDefault();
      editor.onStartProfileFieldEdit(editor.selectedProfileFieldId, editor.profileDraftText ?? "");
    }
    if ((event.key === "Enter" || event.key === "F2") && !editor.editingSectionTitleId && editor.selectedSectionTitleId && editor.onStartSectionTitleEdit) {
      event.preventDefault();
      editor.onStartSectionTitleEdit(editor.selectedSectionTitleId, editor.sectionTitleDraftText ?? "");
    }
    if (event.key === "Escape" && editor.editingItemId) {
      event.preventDefault();
      editor.onCancel();
    }
    if (event.key === "Escape" && editor.editingProfileFieldId && editor.onCancelProfileField) {
      event.preventDefault();
      editor.onCancelProfileField();
    }
    if (event.key === "Escape" && editor.editingSectionTitleId && editor.onCancelSectionTitle) {
      event.preventDefault();
      editor.onCancelSectionTitle();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editor.editingItemId) {
      event.preventDefault();
      editor.onSave();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editor.editingProfileFieldId && editor.onSaveProfileField) {
      event.preventDefault();
      editor.onSaveProfileField();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editor.editingSectionTitleId && editor.onSaveSectionTitle) {
      event.preventDefault();
      editor.onSaveSectionTitle();
    }
  }

  function handleEditorTextAreaKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    onSave?: () => void,
    onCancel?: () => void
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSave) {
      event.preventDefault();
      onSave();
    }
  }

  function pageContainsSelectedBlock(pageModel: ResumeRenderModel) {
    if (!editor?.selectedBlock) {
      return false;
    }
    return pageModel.sections.some((section) =>
      section.blocks.some((block) => block.sourceItemId === editor.selectedBlock?.contentItemId)
    );
  }
  const selectedBlockRendered = visiblePageModels.some((pageModel) => pageContainsSelectedBlock(pageModel));
  const previewZoomStyle = { "--resume-preview-zoom": zoom } as CSSProperties;

  function renderEditorOverlay() {
    if (!editor?.enabled || (!editor.selectedBlock && !editor.selectedProfileFieldId && !editor.selectedSectionTitleId)) {
      return null;
    }
    const profileFieldSelected = Boolean(editor.selectedProfileFieldId && !editor.selectedBlock);
    const sectionTitleSelected = Boolean(editor.selectedSectionTitleId && !editor.selectedBlock && !editor.selectedProfileFieldId);
    const profileFieldEditing = Boolean(editor.editingProfileFieldId && editor.editingProfileFieldId === editor.selectedProfileFieldId);
    const sectionTitleEditing = Boolean(editor.editingSectionTitleId && editor.editingSectionTitleId === editor.selectedSectionTitleId);
    const blockEditing = Boolean(editor.selectedBlock && editor.editingItemId === editor.selectedBlock.contentItemId);
    if (!profileFieldEditing && !sectionTitleEditing && !blockEditing) {
      return null;
    }
    const profileFieldText = editor.profileDraftText ?? "";
    const sectionTitleText = editor.sectionTitleDraftText ?? "";
    const saveOnOutsideBlur = (event: FocusEvent<HTMLTextAreaElement>, onSave?: () => void) => {
      if (editor.pending) {
        return;
      }
      const nextTarget = event.relatedTarget;
      const editorPanel = event.currentTarget.closest("[data-testid='resume-studio-editor']");
      if (nextTarget instanceof HTMLElement && editorPanel?.contains(nextTarget)) {
        return;
      }
      onSave?.();
    };
    return (
      <div
        className="resume-studio-editor no-print"
        data-testid="resume-studio-editor"
        style={overlayRect ? {
          left: `${overlayRect.left}px`,
          top: `${overlayRect.top}px`,
          width: `${overlayRect.width}px`,
          maxWidth: "calc(100% - 24px)"
        } : undefined}
      >
        <div>
          <strong>{profileFieldSelected ? "编辑基本信息" : sectionTitleSelected ? "编辑栏目标题" : "编辑段落"}</strong>
          <span>
            {profileFieldSelected
              ? editor.selectedProfileFieldLabel
              : sectionTitleSelected
                ? editor.selectedSectionTitleLabel
                : `${contentItemTypeLabel(editor.selectedBlock?.itemType)} / ${guardStatusLabel(editor.selectedBlock?.guardStatus)}`}
          </span>
        </div>
        {profileFieldEditing ? (
          <>
            <textarea
              aria-label="编辑简历基本信息"
              autoFocus
              value={profileFieldText}
              disabled={editor.pending}
              onChange={(event) => editor.onProfileDraftTextChange?.(event.target.value)}
              onKeyDown={(event) => handleEditorTextAreaKeyDown(event, editor.onSaveProfileField, editor.onCancelProfileField)}
              onBlur={(event) => saveOnOutsideBlur(event, editor.onSaveProfileField)}
            />
            <div className="action-row">
              <button className="primary-button compact" disabled={editor.pending} onClick={editor.onSaveProfileField}>保存</button>
              <button className="secondary-button compact" disabled={editor.pending} onClick={editor.onCancelProfileField}>取消</button>
            </div>
          </>
        ) : sectionTitleEditing ? (
          <>
            <textarea
              aria-label="编辑简历栏目标题"
              autoFocus
              value={sectionTitleText}
              disabled={editor.pending}
              onChange={(event) => editor.onSectionTitleDraftTextChange?.(event.target.value)}
              onKeyDown={(event) => handleEditorTextAreaKeyDown(event, editor.onSaveSectionTitle, editor.onCancelSectionTitle)}
              onBlur={(event) => saveOnOutsideBlur(event, editor.onSaveSectionTitle)}
            />
            <div className="action-row">
              <button className="primary-button compact" disabled={editor.pending} onClick={editor.onSaveSectionTitle}>保存</button>
              <button className="secondary-button compact" disabled={editor.pending} onClick={editor.onCancelSectionTitle}>取消</button>
            </div>
          </>
        ) : blockEditing ? (
          <>
            <textarea
              aria-label="编辑简历区块正文"
              autoFocus
              value={editor.draftText}
              disabled={editor.pending}
              onChange={(event) => editor.onDraftTextChange(event.target.value)}
              onKeyDown={(event) => handleEditorTextAreaKeyDown(event, editor.onSave, editor.onCancel)}
              onBlur={(event) => saveOnOutsideBlur(event, editor.onSave)}
            />
            <div className="action-row">
              <button className="primary-button compact" disabled={editor.pending} onClick={editor.onSave}>保存</button>
              <button className="secondary-button compact" disabled={editor.pending} onClick={editor.onCancel}>取消</button>
            </div>
          </>
        ) : (
          <>
            <div className="action-row">
              {profileFieldSelected ? (
                <button
                  className="primary-button compact"
                  disabled={editor.pending || !editor.onStartProfileFieldEdit}
                  onClick={() => editor.onStartProfileFieldEdit?.(editor.selectedProfileFieldId!, profileFieldText)}
                >
                  编辑
                </button>
              ) : sectionTitleSelected ? (
                <button
                  className="primary-button compact"
                  disabled={editor.pending || !editor.onStartSectionTitleEdit}
                  onClick={() => editor.onStartSectionTitleEdit?.(editor.selectedSectionTitleId!, sectionTitleText)}
                >
                  编辑
                </button>
              ) : (
                <button
                  className="primary-button compact"
                  disabled={!editor.selectedBlock?.editable || editor.pending}
                  onClick={() => editor.selectedBlock && editor.onStartEdit(editor.selectedBlock.contentItemId)}
                >
                  编辑
                </button>
              )}
            </div>
            {!profileFieldSelected && editor.selectedBlock ? <div className="action-row resume-structure-actions">
              <button
                className="secondary-button compact"
                disabled={editor.pending || !editor.onMoveUp}
                onClick={() => editor.selectedBlock && editor.onMoveUp?.(editor.selectedBlock.contentItemId)}
              >
                上移
              </button>
              <button
                className="secondary-button compact"
                disabled={editor.pending || !editor.onMoveDown}
                onClick={() => editor.selectedBlock && editor.onMoveDown?.(editor.selectedBlock.contentItemId)}
              >
                下移
              </button>
              <button
                className="secondary-button compact"
                disabled={editor.pending || !editor.onHide}
                onClick={() => editor.selectedBlock && editor.onHide?.(editor.selectedBlock.contentItemId)}
              >
                隐藏
              </button>
              <button
                className="secondary-button compact resume-delete-button"
                disabled={editor.pending || !editor.onDelete}
                onClick={() => editor.selectedBlock && editor.onDelete?.(editor.selectedBlock.contentItemId)}
              >
                删除
              </button>
            </div> : null}
          </>
        )}
        {profileFieldSelected && editor.profileError ? <p className="save-status save-status-failed">{editor.profileError}</p> : null}
        {sectionTitleSelected && editor.sectionTitleError ? <p className="save-status save-status-failed">{editor.sectionTitleError}</p> : null}
        {!profileFieldSelected && editor.error ? <p className="save-status save-status-failed">{editor.error}</p> : null}
        {!profileFieldSelected && editor.selectedBlock && !editor.selectedBlock.editable ? (
          <p className="save-status save-status-failed">当前段落不可编辑：{notEditableReasonLabel(editor.selectedBlock.notEditableReason)}</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <article
        ref={pageRef}
        className={`resume-a4-page ${template.className} resume-pagination-measurement-page no-print`}
        style={resumeTemplateStyleVars(template, presentationConfig)}
        data-testid="resume-pagination-measurement-page"
        data-resume-pagination-measurement="true"
        aria-hidden="true"
      >
        {template.render(model, { presentationConfig })}
      </article>
      <div className="resume-preview-pages" style={previewZoomStyle}>
        {visiblePageModels.map((pageModel, index) => (
          <div className="resume-page-shell" key={`${pageModel.branchCurrentRevisionId}-${paginationPlan?.paginationHash ?? "single"}-${index}`}>
            <div className="resume-page-label no-print">第 {index + 1} 页 / 共 {pageCount} 页</div>
            <article
              className={`resume-a4-page ${template.className} ${editor?.enabled ? "resume-studio-edit-enabled" : ""}`}
              style={resumeTemplateStyleVars(template, presentationConfig)}
              data-testid="resume-a4-page"
              aria-label={`A4 简历预览第 ${index + 1} 页`}
              tabIndex={editor?.enabled ? 0 : undefined}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
            >
              {template.render(pageModel, {
                selectedItemId: editor?.selectedItemId,
                selectedProfileFieldId: editor?.selectedProfileFieldId,
                selectedSectionTitleId: editor?.selectedSectionTitleId,
                presentationConfig,
                pagination: {
                  pageNumber: index + 1,
                  pageCount,
                  isContinuation: index > 0
                }
              })}
              {presentationConfig?.pagination.headerFooter === "page_number" ? (
                <footer className="resume-page-footer" aria-label={`第 ${index + 1} 页，共 ${pageCount} 页`}>
                  {index + 1} / {pageCount}
                </footer>
              ) : null}
              {pageContainsSelectedBlock(pageModel)
                || (index === 0 && editor?.selectedProfileFieldId)
                || (index === 0 && editor?.selectedSectionTitleId)
                || (index === 0 && editor?.selectedBlock && !selectedBlockRendered)
                ? renderEditorOverlay()
                : null}
            </article>
          </div>
        ))}
      </div>
    </>
  );
}

function contentItemTypeLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    summary: "个人总结",
    experience: "经历",
    skill: "技能",
    certificate: "证书"
  };
  return value ? labels[value] ?? "段落" : "段落";
}

function guardStatusLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    rule_only_verified: "规则检查通过",
    ai_verified: "已通过事实检查",
    needs_review: "需要复核",
    blocked: "存在风险"
  };
  return value ? labels[value] ?? "需要复核" : "需要复核";
}

function notEditableReasonLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    missing_current_revision: "缺少当前版本",
    hidden_by_content: "该内容已在正文中隐藏",
    hidden_by_presentation: "该段落已在版面中隐藏",
    unsupported_block_type: "该段落类型暂不支持直接编辑"
  };
  return value ? labels[value] ?? value : "当前状态不支持编辑";
}
