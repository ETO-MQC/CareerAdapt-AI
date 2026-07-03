"use client";

import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import type { ResumeRenderModel } from "@/domain/schemas";
import { type TemplateDefinition } from "./templates/templateRegistry";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";

export type ResumeStudioEditorProps = {
  enabled: boolean;
  selectedItemId?: string;
  editingItemId?: string;
  selectedBlock?: ResumeDocumentBlock;
  draftText: string;
  error?: string;
  pending: boolean;
  onSelect: (itemId: string) => void;
  onStartEdit: (itemId: string) => void;
  onDraftTextChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onMoveUp?: (itemId: string) => void;
  onMoveDown?: (itemId: string) => void;
  onHide?: (itemId: string) => void;
};

export function A4ResumePreview({
  model,
  template,
  pageRef,
  editor
}: {
  model: ResumeRenderModel;
  template: TemplateDefinition;
  pageRef: RefObject<HTMLElement | null>;
  editor?: ResumeStudioEditorProps;
}) {
  function findSourceItemId(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return undefined;
    }
    return target.closest<HTMLElement>("[data-source-item-id]")?.dataset.sourceItemId;
  }

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    const itemId = findSourceItemId(event.target);
    if (itemId) {
      editor.onSelect(itemId);
    }
  }

  function handleDoubleClick(event: MouseEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    const itemId = findSourceItemId(event.target);
    if (itemId) {
      editor.onSelect(itemId);
      editor.onStartEdit(itemId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!editor?.enabled) {
      return;
    }
    if ((event.key === "Enter" || event.key === "F2") && !editor.editingItemId && editor.selectedItemId) {
      event.preventDefault();
      editor.onStartEdit(editor.selectedItemId);
    }
    if (event.key === "Escape" && editor.editingItemId) {
      event.preventDefault();
      editor.onCancel();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editor.editingItemId) {
      event.preventDefault();
      editor.onSave();
    }
  }

  return (
    <article
      ref={pageRef}
      className={`resume-a4-page ${template.className} ${editor?.enabled ? "resume-studio-edit-enabled" : ""}`}
      data-testid="resume-a4-page"
      aria-label="A4 简历预览"
      tabIndex={editor?.enabled ? 0 : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {template.render(model, { selectedItemId: editor?.selectedItemId })}
      {editor?.enabled && editor.selectedBlock ? (
        <div className="resume-studio-editor no-print" data-testid="resume-studio-editor">
          <div>
            <strong>编辑区块</strong>
            <span>{editor.selectedBlock.itemType} / {editor.selectedBlock.guardStatus}</span>
          </div>
          {editor.editingItemId === editor.selectedBlock.contentItemId ? (
            <>
              <textarea
                aria-label="编辑简历区块正文"
                autoFocus
                value={editor.draftText}
                disabled={editor.pending}
                onChange={(event) => editor.onDraftTextChange(event.target.value)}
              />
              <div className="action-row">
                <button className="primary-button compact" disabled={editor.pending} onClick={editor.onSave}>保存</button>
                <button className="secondary-button compact" disabled={editor.pending} onClick={editor.onCancel}>取消</button>
              </div>
            </>
          ) : (
            <>
              <div className="action-row">
                <button
                  className="primary-button compact"
                  disabled={!editor.selectedBlock.editable || editor.pending}
                  onClick={() => editor.onStartEdit(editor.selectedBlock!.contentItemId)}
                >
                  编辑
                </button>
              </div>
              <div className="action-row resume-structure-actions">
                <button
                  className="secondary-button compact"
                  disabled={editor.pending || !editor.onMoveUp}
                  onClick={() => editor.onMoveUp?.(editor.selectedBlock!.contentItemId)}
                >
                  上移
                </button>
                <button
                  className="secondary-button compact"
                  disabled={editor.pending || !editor.onMoveDown}
                  onClick={() => editor.onMoveDown?.(editor.selectedBlock!.contentItemId)}
                >
                  下移
                </button>
                <button
                  className="secondary-button compact"
                  disabled={editor.pending || !editor.onHide}
                  onClick={() => editor.onHide?.(editor.selectedBlock!.contentItemId)}
                >
                  隐藏
                </button>
              </div>
            </>
          )}
          {editor.error ? <p className="save-status save-status-failed">{editor.error}</p> : null}
          {!editor.selectedBlock.editable ? (
            <p className="save-status save-status-failed">当前区块不可编辑：{editor.selectedBlock.notEditableReason}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
