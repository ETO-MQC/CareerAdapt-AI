"use client";

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
  onAdd: () => void;
  nav: SectionNavContext;
};

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
  nav
}: ExperienceSectionPageProps) {
  const prev = prevSection(nav.activeSection);
  const next = nextSection(nav.activeSection);

  const accordionItems = blocks.map((block, index) => {
    const sourceItem = branch?.contentItems.find((item) => item.id === block.contentItemId);
    const currentText = editTexts[block.contentItemId] ?? block.text;
    const org = extractStructuredField(currentText, "organization");
    const role = extractStructuredField(currentText, "role");
    const location = extractStructuredField(currentText, "location");
    const startDate = extractStructuredField(currentText, "start");
    const endDate = extractStructuredField(currentText, "end");
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
              label="公司 / 组织"
              value={org}
              placeholder="公司名称"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "organization", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <FieldInput
              label="职位 / 角色"
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
              label="地点"
              value={location}
              placeholder="城市、省份、国家或远程（可选）"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "location", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <div className="field-input-group field-input-group-checkbox">
              <label className="field-input-checkbox-label">
                <input type="checkbox" checked={false} readOnly />
                <span>当前职位</span>
              </label>
            </div>
          </div>
          <div className="section-fields-grid-2">
            <FieldInput
              label="开始日期"
              type="date"
              value={startDate}
              placeholder="YYYY-MM-DD"
              onChange={(value) => {
                onEditTextChange(block.contentItemId, updateStructuredFieldInText(currentText, "start", value));
              }}
              onFocus={() => onSelectItem(block.contentItemId)}
            />
            <FieldInput
              label="结束日期"
              type="date"
              value={endDate}
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
          </div>
        </div>
      )
    };
  });

  return (
    <SectionShell
      icon={<span className="section-shell-icon-svg">💼</span>}
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
    >
      <AccordionList
        items={accordionItems}
        emptyHint={`暂无${sectionLabel}内容。请在个人资料库中添加相关经历后，即可在此编辑。`}
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
