"use client";

import { useState } from "react";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import { TipTapEditor } from "../TipTapEditor";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { contentItemTypeLabel, guardStatusLabel, plainTextToHtml, htmlToPlainText } from "../helpers";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type SkillsSectionPageProps = {
  sectionLabel: string;
  blocks: ResumeDocumentBlock[];
  editTexts: Record<string, string>;
  selectedItemId?: string;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  onSetPresentationVisibility: (itemId: string, visible: boolean) => void;
  onDelete: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onAdd: (text: string) => void;
  onOpenLibrary: () => void;
  nav: SectionNavContext;
};

function DefaultSkillsFields({ sectionLabel, onAdd, onCancel }: { sectionLabel: string; onAdd: (text: string) => void; onCancel?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="section-fields">
      <div className="field-input-group">
        <label className="field-input-label" htmlFor={`new-${sectionLabel}-item`}>{sectionLabel}名称或说明</label>
        <input id={`new-${sectionLabel}-item`} className="field-input" placeholder={`填写一项${sectionLabel}`} value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <div className="section-summary-actions">
        <button type="button" className="section-action-button section-action-button-primary" disabled={!value.trim()} onClick={() => { onAdd(value); setValue(""); }}>
          保存并确认
        </button>
        {onCancel ? <button type="button" className="section-action-button" onClick={onCancel}>取消</button> : null}
      </div>
    </div>
  );
}

export function SkillsSectionPage({
  sectionLabel,
  blocks,
  editTexts,
  selectedItemId,
  onEditTextChange,
  onSave,
  onSetPresentationVisibility,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAdd,
  onOpenLibrary,
  nav
}: SkillsSectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);
  const [adding, setAdding] = useState(false);

  const accordionItems = blocks.map((block, index) => {
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
          {block.presentationHidden ? (
            <div className="field-warning-box">该内容仅从当前简历预览中隐藏，仍保留在正文中。</div>
          ) : null}
          <div className="experience-item-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              onClick={() => onSave(block.contentItemId)}
            >
              保存
            </button>
            <button type="button" className="section-action-button" aria-label={`上移${displayText}`} onClick={() => onMoveUp(block.contentItemId)}>↑</button>
            <button type="button" className="section-action-button" aria-label={`下移${displayText}`} onClick={() => onMoveDown(block.contentItemId)}>↓</button>
            <label className="field-input-checkbox-label field-inline-toggle">
              <input type="checkbox" aria-label={`在简历中显示：${displayText}`} checked={block.visible} onChange={(event) => onSetPresentationVisibility(block.contentItemId, event.target.checked)} />
              <span>显示</span>
            </label>
            <button type="button" className="section-action-button" onClick={() => onDuplicate(block.contentItemId)}>复制</button>
            <button type="button" className="section-action-button section-action-button-danger" onClick={() => onDelete(block.contentItemId)}>删除</button>
          </div>
        </div>
      )
    };
  });
  const showDraft = blocks.length === 0 || adding;
  if (showDraft) {
    accordionItems.push({
      id: `new-${sectionLabel}`,
      title: `未保存的${sectionLabel}`,
      subtitle: "填写后保存到当前简历",
      badge: "草稿",
      defaultOpen: true,
      content: (
        <DefaultSkillsFields
          sectionLabel={sectionLabel}
          onAdd={(text) => {
            onAdd(text);
            setAdding(false);
          }}
          onCancel={blocks.length > 0 ? () => setAdding(false) : undefined}
        />
      )
    });
  }

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">项</span>}
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
      headerAction={<button type="button" className="section-action-button" onClick={onOpenLibrary}>资料库</button>}
    >
      <AccordionList
        items={accordionItems}
        emptyHint={undefined}
        addButton={blocks.length > 0 && !adding ? (
          <button
            type="button"
            className="section-action-button section-action-button-primary"
            onClick={() => setAdding((current) => !current)}
          >
            + 添加{sectionLabel}
          </button>
        ) : undefined}
      />
    </SectionShell>
  );
}
