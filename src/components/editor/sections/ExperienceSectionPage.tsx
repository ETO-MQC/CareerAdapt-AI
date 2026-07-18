"use client";

import { useMemo, useState } from "react";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import type { ResumeBranch, ResumeContentItemV2, ResumeItemV2 } from "@/domain/schemas";
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

/** Convert a v2 canonical ResumeItemV2 to the flat StructuredExperienceFields form shape. */
function canonicalToFormFields(item: ResumeItemV2): StructuredExperienceFields {
  if (item.sectionType === "education") {
    return {
      organization: item.school ?? "",
      role: item.degree ?? "",
      location: item.location ?? "",
      degree: item.degree ?? "",
      major: item.major ?? "",
      courses: (item.courses ?? []).join("、"),
      startDate: item.startDate ?? "",
      endDate: item.endDate ?? "",
      current: item.current ?? false,
      description: item.description ?? ""
    };
  }
  if (item.sectionType === "project") {
    return {
      organization: item.title ?? "",
      role: item.role ?? "",
      location: item.location ?? "",
      degree: "",
      major: "",
      courses: "",
      startDate: item.startDate ?? "",
      endDate: item.endDate ?? "",
      current: item.current ?? false,
      description: item.description ?? ""
    };
  }
  // work / internship / campus / volunteer
  const org = "organization" in item ? (item as { organization?: string }).organization ?? "" : "";
  const role = "role" in item ? (item as { role?: string }).role ?? "" : "";
  const loc = "location" in item ? (item as { location?: string }).location ?? "" : "";
  const sd = "startDate" in item ? (item as { startDate?: string }).startDate ?? "" : "";
  const ed = "endDate" in item ? (item as { endDate?: string }).endDate ?? "" : "";
  const cur = "current" in item ? Boolean((item as { current?: boolean }).current) : false;
  const desc = "description" in item ? (item as { description?: string }).description ?? "" : "";
  return { organization: org, role, location: loc, degree: "", major: "", courses: "", startDate: sd, endDate: ed, current: cur, description: desc };
}

/** Convert form fields back to a patched v2 canonical item (preserving all other fields). */
function formFieldsToCanonicalPatch(item: ResumeItemV2, fields: StructuredExperienceFields): ResumeItemV2 {
  const desc = fields.description.trim() || undefined;
  if (item.sectionType === "education") {
    return {
      ...item,
      school: fields.organization.trim() || undefined,
      degree: fields.degree.trim() || fields.role.trim() || undefined,
      major: fields.major.trim() || undefined,
      location: fields.location.trim() || undefined,
      startDate: fields.startDate || undefined,
      endDate: fields.current ? undefined : (fields.endDate || undefined),
      current: fields.current,
      courses: fields.courses.split(/[、,，;；]/).map((c) => c.trim()).filter(Boolean),
      description: desc
    };
  }
  if (item.sectionType === "project") {
    return {
      ...item,
      title: fields.organization.trim() || undefined,
      role: fields.role.trim() || undefined,
      location: fields.location.trim() || undefined,
      startDate: fields.startDate || undefined,
      endDate: fields.current ? undefined : (fields.endDate || undefined),
      current: fields.current,
      description: desc
    };
  }
  // work / internship / campus / volunteer
  return {
    ...item,
    organization: fields.organization.trim() || undefined,
    role: fields.role.trim() || undefined,
    location: fields.location.trim() || undefined,
    startDate: fields.startDate || undefined,
    endDate: fields.current ? undefined : (fields.endDate || undefined),
    current: fields.current,
    description: desc
  } as ResumeItemV2;
}

type ExperienceSectionPageProps = {
  sectionLabel: string;
  blocks: ResumeDocumentBlock[];
  branch?: ResumeBranch;
  /** v2 canonical structured items — when present, form reads/writes canonical fields directly. */
  structuredItems?: ResumeContentItemV2[];
  editTexts: Record<string, string>;
  selectedItemId?: string;
  onEditTextChange: (itemId: string, text: string) => void;
  onSave: (itemId: string) => void;
  /** Save canonical structured item (v2 path). Called when structuredItems are available. */
  onSaveStructuredItem?: (item: ResumeItemV2) => void;
  onSelectItem: (itemId: string) => void;
  onSetPresentationVisibility: (itemId: string, visible: boolean) => void;
  onDelete: (itemId: string) => void;
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
  structuredItems,
  editTexts,
  selectedItemId,
  onEditTextChange,
  onSave,
  onSaveStructuredItem,
  onSelectItem,
  onSetPresentationVisibility,
  onDelete,
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
  const structuredMap = useMemo(() => {
    if (!structuredItems) return undefined;
    return new Map(structuredItems.map((item) => [item.id, item]));
  }, [structuredItems]);

  const accordionItems = blocks.map((block, index) => {
    const category = experienceCategoryFromLabel(sectionLabel);
    const sourceItem = branch?.contentItems.find((item) => item.id === block.contentItemId);
    const canonicalItem = structuredMap?.get(block.contentItemId);

    // When a v2 canonical item exists, derive form fields from it directly
    // instead of re-parsing the legacy text projection.
    const structuredFields = canonicalItem
      ? canonicalToFormFields(canonicalItem.data)
      : (() => {
          const currentText = editTexts[block.contentItemId] ?? block.text;
          const parsed = parseStructuredExperienceText(currentText);
          if (category === "education" && !parsed.degree) parsed.degree = parsed.role;
          return parsed;
        })();

    const org = structuredFields.organization;
    const role = category === "education" ? structuredFields.degree : structuredFields.role;
    const titleText = org && role ? `${org} · ${role}` : org || role || `${sectionLabel} ${index + 1}`;
    const isOpen = selectedItemId ? selectedItemId === block.contentItemId : index === 0;

    const handleFormChange = (next: StructuredExperienceFields) => {
      if (canonicalItem && onSaveStructuredItem) {
        // v2 path: patch canonical item and save via structured save
        const patched = formFieldsToCanonicalPatch(canonicalItem.data, next);
        onSaveStructuredItem(patched);
      } else {
        // v1 fallback: serialize to text
        onEditTextChange(block.contentItemId, serializeStructuredExperienceText(next, category));
      }
    };

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
            onChange={handleFormChange}
            idPrefix={`existing-${block.contentItemId}`}
            onFocus={() => onSelectItem(block.contentItemId)}
          />
          {block.presentationHidden ? (
            <div className="field-warning-box">该内容仅从当前简历预览中隐藏，仍保留在正文中。</div>
          ) : null}
          <div className="experience-item-actions">
            <button
              type="button"
              className="section-action-button section-action-button-primary"
              onClick={() => {
                if (canonicalItem && onSaveStructuredItem) {
                  const patched = formFieldsToCanonicalPatch(canonicalItem.data, structuredFields);
                  onSaveStructuredItem(patched);
                } else {
                  onSave(block.contentItemId);
                }
              }}
            >
              保存
            </button>
            <button
              type="button"
              className="section-action-button"
              aria-label={`上移${titleText}`}
              onClick={() => onMoveUp(block.contentItemId)}
            >
              ↑
            </button>
            <button
              type="button"
              className="section-action-button"
              aria-label={`下移${titleText}`}
              onClick={() => onMoveDown(block.contentItemId)}
            >
              ↓
            </button>
            <label className="field-input-checkbox-label field-inline-toggle">
              <input
                type="checkbox"
                aria-label={`在简历中显示：${titleText}`}
                checked={block.visible}
                onChange={(event) => onSetPresentationVisibility(block.contentItemId, event.target.checked)}
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
              className="section-action-button section-action-button-danger"
              onClick={() => onDelete(block.contentItemId)}
            >
              删除
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
