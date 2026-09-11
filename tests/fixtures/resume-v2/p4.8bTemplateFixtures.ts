import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { ResumeRenderModelSchema, type ResumeRenderModelV2 } from "@/domain/schemas";

export type P48bTemplateFixture = {
  name: "technical-student" | "business-student" | "dense-mixed" | "minimal";
  model: ResumeRenderModelV2;
};

/** Four sanitized presentation fixtures; all values come from the example corpus. */
export function createP48bTemplateFixtures(): P48bTemplateFixture[] {
  const base = createResumeJsonV2Example();
  return [
    buildFixture(base, "technical-student", "软件工程实习生"),
    buildFixture(base, "business-student", "商业分析实习生"),
    buildFixture(base, "dense-mixed", "数据与产品实践者"),
    buildFixture(base, "minimal", "应届分析师", ["summary", "education", "skills", "certificates"])
  ];
}

function buildFixture(
  base: ReturnType<typeof createResumeJsonV2Example>,
  name: P48bTemplateFixture["name"],
  targetRole: string,
  sectionFilter?: string[]
): P48bTemplateFixture {
  const sections = base.sections.filter((section) => !sectionFilter || sectionFilter.includes(section.sectionType));
  const model = ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v2",
    branchId: `p4-8b-${name}`,
    branchRevision: 1,
    branchCurrentRevisionId: `revision-${name}`,
    branchName: `${name} fixture`,
    jobTitle: targetRole,
    company: "示例组织",
    candidate: {
      name: base.basics.name ?? "候选人",
      targetRole,
      contacts: [base.basics.phone, base.basics.email, base.basics.homepage, base.basics.location].filter(Boolean)
    },
    sections: [],
    structuredSections: sections.map((section) => ({
      sectionId: section.id,
      sectionType: section.sectionType,
      title: section.title,
      order: section.order,
      items: section.items.map((item) => ({
        sectionId: section.id,
        sectionType: section.sectionType,
        itemId: item.id,
        data: item,
        plainText: `fixture:${name}:${item.id}`,
        presentation: { ...projectResumePresentationItem(item), id: `p4-8b-${name}-${item.id}`, sourceItemId: item.id }
      }))
    })),
    compatibilityWarnings: [],
    safety: {
      ruleOnlyItemIds: [],
      visibleItemCount: sections.reduce((count, section) => count + section.items.length, 0),
      excludedItemIds: []
    },
    sourceTrace: {
      profileId: `profile-${name}`,
      currentRevisionId: `revision-${name}`,
      sourceProfileVersion: 1
    }
  });
  if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 fixture");
  return { name, model };
}
