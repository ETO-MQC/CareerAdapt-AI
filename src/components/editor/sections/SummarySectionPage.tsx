"use client";

import { useState } from "react";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
import { TipTapEditor } from "../TipTapEditor";
import { SectionShell } from "../SectionShell";
import { plainTextToHtml, htmlToPlainText } from "../helpers";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type SummarySectionPageProps = {
  blocks: ResumeDocumentBlock[];
  profile?: CareerProfile;
  branch?: ResumeBranch;
  editTexts: Record<string, string>;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  onAdd: (text: string) => void;
  onSetPresentationVisibility: (itemId: string, visible: boolean) => void;
  onDelete: (itemId: string) => void;
  onSyncToProfile: (itemId: string) => void;
  nav: SectionNavContext;
};

export function SummarySectionPage({
  blocks,
  profile,
  branch,
  editTexts,
  onEditTextChange,
  onSave,
  onAdd,
  onSetPresentationVisibility,
  onDelete,
  onSyncToProfile,
  nav
}: SummarySectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);
  const block = blocks[0];
  const [newSummary, setNewSummary] = useState("");
  const currentText = block ? (editTexts[block.contentItemId] ?? block.text) : newSummary;
  const sourceItem = block ? branch?.contentItems.find((item) => item.id === block.contentItemId) : undefined;
  const isSyncedToProfile = Boolean(block && profile?.basics.summary?.trim() === currentText.trim());

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">评</span>}
      title="自我评价"
      description="在简历顶部添加简短的自我评价。您可以利用 AI 根据经验和技能生成内容。"
      saved={!block || !(block.contentItemId in editTexts)}
      canUndo={nav.canUndo}
      canRedo={nav.canRedo}
      onUndo={nav.onUndo}
      onRedo={nav.onRedo}
      hasPrev={Boolean(prev)}
      hasNext={Boolean(next)}
      onPrev={() => prev && nav.onNavigate(prev)}
      onNext={() => next && nav.onNavigate(next)}
    >
      <div className="section-summary-editor">
        <TipTapEditor
          value={plainTextToHtml(currentText)}
          onChange={(html) => {
            const text = htmlToPlainText(html);
            if (block) onEditTextChange(block.contentItemId, text);
            else setNewSummary(text);
          }}
          placeholder="例如：可靠的人，学习快，团队合作好。"
          minRows={8}
        />
        {block ? (
          <>
            {block.presentationHidden ? <div className="field-warning-box">该内容仅从当前简历预览中隐藏，仍保留在正文中。</div> : null}
            <div className="section-summary-actions">
              <button
                type="button"
                className="section-action-button section-action-button-primary"
                disabled={!(block.contentItemId in editTexts)}
                onClick={() => onSave(block.contentItemId)}
              >
                保存
              </button>
              <label className="field-input-checkbox-label field-inline-toggle">
                <input
                  type="checkbox"
                  aria-label="在简历中显示：自我评价"
                  checked={block.visible}
                  onChange={(event) => onSetPresentationVisibility(block.contentItemId, event.target.checked)}
                />
                <span>显示</span>
              </label>
              {isSyncedToProfile ? (
                <span className="resume-sync-state resume-sync-state-synced">已同步资料库</span>
              ) : (
                <>
                  {sourceItem?.userConfirmation?.scope === "resume_only" ? <span className="resume-sync-state">仅当前简历</span> : null}
                  <button
                    type="button"
                    className="section-action-button"
                    disabled={block.contentItemId in editTexts}
                    onClick={() => onSyncToProfile(block.contentItemId)}
                  >
                    同步到资料库
                  </button>
                </>
              )}
              <button type="button" className="section-action-button section-action-button-danger" onClick={() => onDelete(block.contentItemId)}>删除</button>
            </div>
          </>
        ) : (
          <div className="section-summary-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              onClick={() => { onAdd(newSummary); setNewSummary(""); }}
              disabled={!newSummary.trim()}
            >
              保存
            </button>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
