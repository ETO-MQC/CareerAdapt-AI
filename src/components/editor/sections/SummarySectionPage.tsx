"use client";

import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import { TipTapEditor } from "../TipTapEditor";
import { SectionShell } from "../SectionShell";
import { plainTextToHtml, htmlToPlainText } from "../helpers";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type SummarySectionPageProps = {
  blocks: ResumeDocumentBlock[];
  editTexts: Record<string, string>;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  onAdd: () => void;
  nav: SectionNavContext;
};

export function SummarySectionPage({
  blocks,
  editTexts,
  onEditTextChange,
  onSave,
  onAdd,
  nav
}: SummarySectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);
  const block = blocks[0];
  const currentText = block ? (editTexts[block.contentItemId] ?? block.text) : "";

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg">📝</span>}
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
            if (block) {
              onEditTextChange(block.contentItemId, htmlToPlainText(html));
            }
          }}
          placeholder="例如：可靠的人，学习快，团队合作好。"
          minRows={8}
        />
        {block ? (
          <div className="section-summary-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              disabled={!(block.contentItemId in editTexts)}
              onClick={() => onSave(block.contentItemId)}
            >
              保存
            </button>
          </div>
        ) : (
          <div className="section-summary-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              onClick={onAdd}
            >
              保存
            </button>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
