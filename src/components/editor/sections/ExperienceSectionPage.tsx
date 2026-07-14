"use client";

import { useState } from "react";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import type { ResumeBranch } from "@/domain/schemas";
import {
  emptyStructuredExperienceFields,
  parseStructuredExperienceText,
  serializeStructuredExperienceText,
  type ResumeFieldCategoryId,
  type StructuredExperienceFields
} from "@/domain/resumeFields/catalog";
import { StructuredExperienceForm } from "../StructuredExperienceForm";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { contentItemTypeLabel, guardStatusLabel } from "../helpers";
import { type SectionNavContext, prevSection, nextSection } from "./types";

type ExperienceSectionPageProps = {
  sectionLabel: string;
  blocks: ResumeDocumentBlock[];
  branch?: ResumeBranch;
  editTexts: Record<string, string>;
  selectedItemId?: string;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
  onSetVisibility: (itemId: string, visible: boolean) => void;
  onDuplicate: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onAdd: (draft: { text: string; organization?: string; role?: string; location?: string; degree?: string; major?: string; courses?: string[]; startDate?: string; endDate?: string }, syncToProfile: boolean) => void;
  onSyncToProfile: (itemId: string) => void;
  onOpenLibrary: () => void;
  nav: SectionNavContext;
};

function DefaultExperienceFields({ sectionLabel, onAdd, onCancel }: { sectionLabel: string; onAdd: ExperienceSectionPageProps["onAdd"]; onCancel?: () => void }) {
  const category = experienceCategoryFromLabel(sectionLabel);
  const [draft, setDraft] = useState<StructuredExperienceFields>(emptyStructuredExperienceFields);
  const save = (syncToProfile: boolean) => {
    const text = serializeStructuredExperienceText(draft, category);
    if (!text) return;
    onAdd({
      text,
      organization: draft.organization,
      role: category === "education" ? draft.degree : draft.role,
      location: draft.location,
      degree: draft.degree,
      major: draft.major,
      courses: draft.courses.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      startDate: draft.startDate,
      endDate: draft.current ? undefined : draft.endDate
    }, syncToProfile);
    setDraft(emptyStructuredExperienceFields);
  };
  return (
    <div className="section-fields">
      <StructuredExperienceForm category={category} value={draft} onChange={setDraft} idPrefix={`new-${category}`} />
      <div className="section-summary-actions">
        <button type="button" className="section-action-button section-action-button-primary" onClick={() => save(false)} disabled={!Object.values(draft).some(Boolean)}>
          保存到简历
        </button>
        <button type="button" className="section-action-button" onClick={() => save(true)} disabled={!Object.values(draft).some(Boolean)}>
          保存并同步资料库
        </button>
        {onCancel ? <button type="button" className="section-action-button" onClick={onCancel}>取消</button> : null}
      </div>
    </div>
  );
}

function experienceCategoryFromLabel(sectionLabel: string): Extract<ResumeFieldCategoryId, "education" | "work" | "project" | "campus"> {
  if (sectionLabel === "教育经历") return "education";
  if (sectionLabel === "项目经历" || sectionLabel === "项目成果") return "project";
  if (sectionLabel === "校园经历") return "campus";
  return "work";
}

export function ExperienceSectionPage({
  sectionLabel,
  blocks,
  branch,
  editTexts,
  selectedItemId,
  onEditTextChange,
  onSave,
  onSelectItem,
  onSetVisibility,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAdd,
  onSyncToProfile,
  onOpenLibrary,
  nav
}: ExperienceSectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);
  const [adding, setAdding] = useState(false);

  const accordionItems = blocks.map((block, index) => {
    const category = experienceCategoryFromLabel(sectionLabel);
    const sourceItem = branch?.contentItems.find((item) => item.id === block.contentItemId);
    const currentText = editTexts[block.contentItemId] ?? block.text;
    const structuredFields = parseStructuredExperienceText(currentText);
    if (category === "education" && !structuredFields.degree) structuredFields.degree = structuredFields.role;
    const org = structuredFields.organization;
    const role = category === "education" ? structuredFields.degree : structuredFields.role;
    const titleText = org && role ? `${org} · ${role}` : org || role || `${sectionLabel} ${index + 1}`;
    const isOpen = selectedItemId ? selectedItemId === block.contentItemId : index === 0;

    return {
      id: block.contentItemId,
      title: titleText,
      subtitle: `${contentItemTypeLabel(block.itemType)} / ${guardStatusLabel(block.guardStatus)}`,
      badge: !block.visible ? "已隐藏" : undefined,
      defaultOpen: isOpen,
      content: (
        <div className="experience-item-fields">
          <StructuredExperienceForm
            category={category}
            value={structuredFields}
            onChange={(next) => onEditTextChange(block.contentItemId, serializeStructuredExperienceText(next, category))}
            idPrefix={`existing-${block.contentItemId}`}
            onFocus={() => onSelectItem(block.contentItemId)}
          />
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
            <button
              type="button"
              className="section-action-button"
              onClick={() => onMoveUp(block.contentItemId)}
            >
              ↑
            </button>
            <button
              type="button"
              className="section-action-button"
              onClick={() => onMoveDown(block.contentItemId)}
            >
              ↓
            </button>
            <label className="field-input-checkbox-label field-inline-toggle">
              <input
                type="checkbox"
                checked={block.visible}
                onChange={(event) => onSetVisibility(block.contentItemId, event.target.checked)}
              />
              <span>显示</span>
            </label>
            <button
              type="button"
              className="section-action-button"
              onClick={() => onDuplicate(block.contentItemId)}
            >
              复制
            </button>
            <button
              type="button"
              className="section-action-button"
              onClick={() => onSetVisibility(block.contentItemId, !sourceItem?.visible)}
            >
              {sourceItem?.visible ? "删除" : "恢复"}
            </button>
            {sourceItem?.userConfirmation?.scope === "resume_only" ? (
              <>
                <span className="resume-sync-state">仅当前简历</span>
                <button
                  type="button"
                  className="section-action-button"
                  onClick={() => onSyncToProfile(block.contentItemId)}
                >
                  同步到资料库
                </button>
              </>
            ) : (
              <span className="resume-sync-state resume-sync-state-synced">已关联资料库</span>
            )}
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
        <DefaultExperienceFields
          sectionLabel={sectionLabel}
          onAdd={(draft, syncToProfile) => {
            onAdd(draft, syncToProfile);
            setAdding(false);
          }}
          onCancel={blocks.length > 0 ? () => setAdding(false) : undefined}
        />
      )
    });
  }

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg" aria-hidden="true">历</span>}
      title={sectionLabel}
      description={`添加${sectionLabel}相关内容。`}
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
