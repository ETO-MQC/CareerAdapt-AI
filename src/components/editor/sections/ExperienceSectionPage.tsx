"use client";

import { useState } from "react";
import type { ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import type { ResumeBranch } from "@/domain/schemas";
import { FieldInput } from "../FieldInput";
import { TipTapEditor } from "../TipTapEditor";
import { AccordionList } from "../AccordionList";
import { SectionShell } from "../SectionShell";
import { contentItemTypeLabel, guardStatusLabel, extractStructuredField, updateStructuredFieldInText, plainTextToHtml, htmlToPlainText } from "../helpers";
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
  onAdd: (draft: { text: string; organization?: string; role?: string; startDate?: string; endDate?: string }, syncToProfile: boolean) => void;
  onSyncToProfile: (itemId: string) => void;
  onOpenLibrary: () => void;
  nav: SectionNavContext;
};

function DefaultExperienceFields({ sectionLabel, onAdd }: { sectionLabel: string; onAdd: ExperienceSectionPageProps["onAdd"] }) {
  const isEducation = sectionLabel === "教育经历";
  const [draft, setDraft] = useState({ organization: "", role: "", location: "", startDate: "", endDate: "", current: false, description: "" });
  const update = (key: keyof typeof draft, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }));
  const save = (syncToProfile: boolean) => {
    const identity = [draft.organization, draft.role].filter(Boolean).join(" / ");
    const dates = draft.startDate
      ? `${draft.startDate} - ${draft.current ? "至今" : draft.endDate}`.replace(/\s+-\s+$/, "")
      : draft.current ? "至今" : draft.endDate;
    const header = [identity, draft.location, dates].filter(Boolean).join("  ");
    const text = [header, draft.description.trim()].filter(Boolean).join("\n");
    if (!text) return;
    onAdd({ text, organization: draft.organization, role: draft.role, startDate: draft.startDate, endDate: draft.current ? undefined : draft.endDate }, syncToProfile);
    setDraft({ organization: "", role: "", location: "", startDate: "", endDate: "", current: false, description: "" });
  };
  return (
    <div className="section-fields">
      <div className="section-fields-grid-2">
        <FieldInput id="new-experience-organization" label={isEducation ? "学校名称" : "公司 / 组织"} placeholder={isEducation ? "学校名称" : "公司名称"} value={draft.organization} onChange={(value) => update("organization", value)} />
        <FieldInput id="new-experience-role" label={isEducation ? "学历" : "职位 / 角色"} placeholder={isEducation ? "例如：本科" : "例如：软件工程师"} value={draft.role} onChange={(value) => update("role", value)} />
      </div>
      <div className="section-fields-grid-2">
        <FieldInput id="new-experience-location" label={isEducation ? "专业名称" : "地点"} placeholder={isEducation ? "例如：计算机相关专业" : "城市、省份（可选）"} value={draft.location} onChange={(value) => update("location", value)} />
        <FieldInput id="new-experience-start" label={isEducation ? "就读开始时间" : "开始日期"} type="date" value={draft.startDate} onChange={(value) => update("startDate", value)} />
      </div>
      <div className="section-fields-grid-2">
        <FieldInput id="new-experience-end" label={isEducation ? "就读结束时间" : "结束日期"} type="date" value={draft.endDate} disabled={draft.current} onChange={(value) => update("endDate", value)} />
        <div className="field-input-group field-input-group-checkbox">
          <label className="field-input-checkbox-label"><input type="checkbox" checked={draft.current} onChange={(event) => update("current", event.target.checked)} /><span>仍在进行</span></label>
        </div>
      </div>
      <div className="experience-description-field">
        <label className="field-input-label">描述要点</label>
        <TipTapEditor value={plainTextToHtml(draft.description)} onChange={(html) => update("description", htmlToPlainText(html))} placeholder="描述你的工作内容和成就…" minRows={4} />
      </div>
      <div className="section-summary-actions">
        <button type="button" className="section-action-button section-action-button-primary" onClick={() => save(false)} disabled={!Object.values(draft).some(Boolean)}>
          保存到简历
        </button>
        <button type="button" className="section-action-button" onClick={() => save(true)} disabled={!Object.values(draft).some(Boolean)}>
          保存并同步资料库
        </button>
      </div>
    </div>
  );
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

  if (blocks.length === 0) {
    return (
      <SectionShell
        icon={<span className="section-shell-icon-svg" aria-hidden="true">历</span>}
        title={sectionLabel}
        description={`添加${sectionLabel}相关内容。`}
        saved={true}
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
        <DefaultExperienceFields sectionLabel={sectionLabel} onAdd={onAdd} />
      </SectionShell>
    );
  }

  const accordionItems = blocks.map((block, index) => {
    const isEducation = sectionLabel === "教育经历";
    const sourceItem = branch?.contentItems.find((item) => item.id === block.contentItemId);
    const currentText = editTexts[block.contentItemId] ?? block.text;
    const org = extractStructuredField(currentText, "organization");
    const role = extractStructuredField(currentText, "role");
    const location = extractStructuredField(currentText, "location");
    const startDate = extractStructuredField(currentText, "start");
    const endDate = extractStructuredField(currentText, "end");
    const isCurrent = extractStructuredField(currentText, "current") === "true";
    const descriptionLines = currentText.split("\n").slice(1).join("\n").trim();
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
          <div className="section-fields-grid-2">
            <FieldInput
              label={isEducation ? "学校名称" : "公司 / 组织"}
              value={org}
              placeholder="公司名称"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "organization", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <FieldInput
              label={isEducation ? "学历" : "职位 / 角色"}
              value={role}
              placeholder="例如：销售专员"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "role", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
          </div>
          <div className="section-fields-grid-2">
            <FieldInput
              label={isEducation ? "专业名称" : "地点"}
              value={location}
              placeholder={isEducation ? "例如：计算机相关专业" : "城市、省份、国家或远程（可选）"}
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "location", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <div className="field-input-group field-input-group-checkbox">
              <label className="field-input-checkbox-label">
                <input
                  type="checkbox"
                  checked={isCurrent}
                  onChange={(event) => {
                    onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "current", String(event.target.checked)));
                  }}
                />
                <span>当前职位</span>
              </label>
            </div>
          </div>
          <div className="section-fields-grid-2">
            <FieldInput
              label={isEducation ? "就读开始时间" : "开始日期"}
              type="date"
              value={startDate}
              placeholder="YYYY-MM-DD"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "start", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <FieldInput
              label={isEducation ? "就读结束时间" : "结束日期"}
              type="date"
              value={endDate}
              disabled={isCurrent}
              placeholder="YYYY-MM-DD"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "end", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
          </div>
          <div className="experience-description-field">
            <label className="field-input-label">描述要点</label>
            <TipTapEditor
              value={plainTextToHtml(descriptionLines)}
              onChange={(html) => {
                const headerLine = currentText.split("\n")[0] ?? "";
                const plainDescription = htmlToPlainText(html);
                onEditTextChange(block.contentItemId, plainDescription ? `${headerLine}\n${plainDescription}` : headerLine);
              }}
              placeholder="描述你的工作内容和成就..."
              minRows={4}
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
        addButton={
          <button
            type="button"
            className="section-action-button section-action-button-primary"
            onClick={() => setAdding((current) => !current)}
          >
            + 添加{sectionLabel}
          </button>
        }
      />
      {adding ? <DefaultExperienceFields sectionLabel={sectionLabel} onAdd={(draft, syncToProfile) => { onAdd(draft, syncToProfile); setAdding(false); }} /> : null}
    </SectionShell>
  );
}
