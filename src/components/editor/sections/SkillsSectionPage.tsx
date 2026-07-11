"use client";

import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import type { ResumeBranch } from "@/domain/schemas";
import { TipTapEditor } from "../TipTapEditor";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { contentItemTypeLabel, guardStatusLabel, plainTextToHtml, htmlToPlainText } from "../helpers";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type SkillsSectionPageProps = {
  sectionLabel: string;
  blocks: ResumeDocumentBlock[];
  branch?: ResumeBranch;
  editTexts: Record<string, string>;
  selectedItemId?: string;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  onSetVisibility: (itemId: string, visible: boolean) => void;
  onDuplicate: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onAdd: () => void;
  nav: SectionNavContext;
};

export function SkillsSectionPage({
  sectionLabel,
  blocks,
  branch,
  editTexts,
  selectedItemId,
  onEditTextChange,
  onSave,
  onSetVisibility,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAdd,
  nav
}: SkillsSectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);

  const accordionItems = blocks.map((block, index) => {
    const sourceItem = branch?.contentItems.find((item) => item.id === block.contentItemId);
    const currentText = editTexts[block.contentItemId] ?? block.text;
    const displayText = currentText.split("\n")[0]?.slice(0, 40) || `${sectionLabel} ${index + 1}`;
    const isOpen = selectedItemId ? selectedItemId === block.contentItemId : index === 0;

    return {
      id: block.contentItemId,
      title: displayText,
      subtitle: `${contentItemTypeLabel(block.itemType)} / ${guardStatusLabel(block.guardStatus)}`,
      badge: !block.visible ? "已隐藏" : undefined,
      defaultOpen: isOpen,
      content: (
        <div className="skill-item-fields">
          <div className="skill-editor">
            <TipTapEditor
              value={plainTextToHtml(currentText)}
              onChange={(html) => onEditTextChange(block.contentItemId, htmlToPlainText(html))}
              placeholder="描述你的技能..."
              minRows={3}
            />
          </div>
          {!sourceItem?.visible ? (
            <div className="field-warning-box">该内容已在正文版本中隐藏。</div>
          ) : null}
          <div className="experience-item-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              onClick={() => onSave(block.contentItemId)}
            >
              保存
            </button>
            <button type="button" className="section-action-button" onClick={() => onMoveUp(block.contentItemId)}>↑</button>
            <button type="button" className="section-action-button" onClick={() => onMoveDown(block.contentItemId)}>↓</button>
            <label className="field-input-checkbox-label field-inline-toggle">
              <input type="checkbox" checked={block.visible} onChange={(event) => onSetVisibility(block.contentItemId, event.target.checked)} />
              <span>显示</span>
            </label>
            <button type="button" className="section-action-button" onClick={() => onDuplicate(block.contentItemId)}>复制</button>
            <button type="button" className="section-action-button" onClick={() => onSetVisibility(block.contentItemId, !sourceItem?.visible)}>
              {sourceItem?.visible ? "删除" : "恢复"}
            </button>
          </div>
        </div>
      )
    };
  });

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg">⚡</span>}
      title={sectionLabel}
      description={`添加${sectionLabel}相关信息。`}
      saved={blocks.every((b) => !(b.contentItemId in editTexts))}
      canUndo={nav.canUndo}
      canRedo={nav.canRedo}
      onUndo={nav.onUndo}
      onRedo={nav.onRedo}
      hasPrev={Boolean(prev)}
      hasNext={Boolean(next)}
      onPrev={() => prev && nav.onNavigate(prev)}
      onNext={() => next && nav.onNavigate(next)}
    >
      <AccordionList
        items={accordionItems}
        emptyHint={`暂无${sectionLabel}内容。`}
        addButton={
          <button
            type="button"
            className="section-action-button section-action-button-primary"
            onClick={onAdd}
          >
            + 添加{sectionLabel}
          </button>
        }
      />
    </SectionShell>
  );
}
