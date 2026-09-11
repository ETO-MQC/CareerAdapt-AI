import type { ResumeRenderBlock, ResumeRenderModel, ResumeRenderSection } from "@/domain/schemas";
import type { TemplateRenderContext } from "../types";
import { editableBlockAttrs, sectionTitleAttrs, selectedClass } from "./canonical";

export function section(
  model: ResumeRenderModel,
  type: ResumeRenderSection["type"],
  mode?: "inline" | "compact" | "tag" | "plain" | "plainInline" | "business",
  context?: TemplateRenderContext
) {
  const found = findSection(model, type);
  return found ? <RenderSection section={found} mode={mode} context={context} /> : null;
}

export function findSection(model: ResumeRenderModel, type: ResumeRenderSection["type"]) {
  return model.sections.find((candidate) => candidate.type === type);
}

export function RenderSection({
  section,
  mode,
  context,
  showSectionTitle
}: {
  section: ResumeRenderSection;
  mode?: "inline" | "compact" | "tag" | "plain" | "plainInline" | "business";
  context?: TemplateRenderContext;
  showSectionTitle?: boolean;
}) {
  const showTitle = (showSectionTitle ?? true)
    && context?.presentationConfig?.sectionStyleOverrides[section.type]?.showTitle !== false;
  const inlineMode = mode === "inline" || mode === "tag" || mode === "plainInline";
  const experienceGroups = section.type === "experience" ? groupExperienceBlocks(section.blocks) : [];
  return (
    <section className={`resume-template-section ${mode ? `resume-section-${mode}` : ""}`} data-render-section={section.type}>
      {showTitle ? <h2 {...sectionTitleAttrs(section, context)}>{section.title}</h2> : null}
      {inlineMode ? (
        <div className={mode === "tag" ? "resume-tag-list" : "resume-inline-list"}>
          {section.blocks.map((block) => (
            <span key={block.sourceItemId} className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</span>
          ))}
        </div>
      ) : (
        <div className="resume-block-list">
          {experienceGroups.length > 0 ? experienceGroups.map((group) => (
            <div className="resume-experience-group" key={group.key} data-resume-experience-group={group.key}>
              <h3 className="resume-experience-group-title">{group.label}</h3>
              {group.blocks.map((block) => (
                <RenderBlock
                  key={block.sourceItemId}
                  block={block}
                  compact={mode === "compact" || mode === "plain"}
                  business={mode === "business"}
                  context={context}
                />
              ))}
            </div>
          )) : section.blocks.map((block) => (
            <RenderBlock
              key={block.sourceItemId}
              block={block}
              compact={mode === "compact" || mode === "plain"}
              business={mode === "business"}
              context={context}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function groupExperienceBlocks(blocks: ResumeRenderBlock[]) {
  type GroupKey = "work" | "internship" | "education" | "project" | "campus" | "awards" | "languages" | "custom";
  const order: GroupKey[] = ["education", "work", "internship", "project", "campus", "awards", "languages", "custom"];
  const labels: Record<GroupKey, string> = {
    work: "工作经历",
    internship: "实习经历",
    education: "教育经历",
    project: "项目经历",
    campus: "校园经历",
    awards: "奖项",
    languages: "语言",
    custom: "其他内容"
  };
  const grouped = new Map<GroupKey, ResumeRenderBlock[]>();
  for (const block of blocks) {
    const aliases: Record<string, GroupKey> = { experience: "work", projects: "project", language: "languages" };
    const normalized = block.sourceSectionId ? aliases[block.sourceSectionId] ?? block.sourceSectionId : "";
    const key = order.includes(normalized as GroupKey)
      ? normalized as GroupKey
      : block.itemType === "experience" ? "work" : "custom";
    grouped.set(key, [...(grouped.get(key) ?? []), block]);
  }
  return order.flatMap((key) => {
    const groupBlocks = grouped.get(key);
    return groupBlocks?.length ? [{ key, label: labels[key], blocks: groupBlocks }] : [];
  });
}

function RenderBlock({
  block,
  compact,
  business,
  context
}: {
  block: ResumeRenderBlock;
  compact?: boolean;
  business?: boolean;
  context?: TemplateRenderContext;
}) {
  if (compact || block.itemType === "summary") {
    return <p className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</p>;
  }

  return (
    <div className={`resume-template-item ${business ? "resume-template-item-business" : ""} ${selectedClass(block, context)}`} {...editableBlockAttrs(block, context)}>
      <p>{block.text}</p>
    </div>
  );
}
