import type { ResumeSectionDefinition, ResumeSectionTypeV2 } from "./types";

export const resumeSectionCatalog = [
  { id: "basics", label: "基本信息", aliases: ["basic", "personal", "personalInfo"], repeatable: false, defaultVisible: true, addable: false, displayOrder: 10 },
  { id: "summary", label: "自我评价", aliases: ["profile", "objective", "about"], repeatable: false, defaultVisible: true, addable: false, displayOrder: 20 },
  { id: "education", label: "教育经历", aliases: ["educations", "academic"], repeatable: true, defaultVisible: true, addable: false, displayOrder: 30 },
  { id: "work", label: "工作经历", aliases: ["employment", "professionalExperience"], repeatable: true, defaultVisible: true, addable: false, displayOrder: 40 },
  { id: "internship", label: "实习经历", aliases: ["internships"], repeatable: true, defaultVisible: true, addable: false, displayOrder: 50 },
  { id: "project", label: "项目经历", aliases: ["projects"], repeatable: true, defaultVisible: true, addable: false, displayOrder: 60 },
  { id: "research", label: "科研经历", aliases: ["researches", "researchExperience"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 70 },
  { id: "campus", label: "校园经历", aliases: ["activities", "campusExperience"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 80 },
  { id: "volunteer", label: "志愿经历", aliases: ["volunteering", "communityService"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 90 },
  { id: "awards", label: "奖项荣誉", aliases: ["award", "honors", "competitions"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 100 },
  { id: "skills", label: "专业技能", aliases: ["skill", "technicalSkills"], repeatable: true, defaultVisible: true, addable: false, displayOrder: 110 },
  { id: "certificates", label: "证书", aliases: ["certificate", "certifications"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 120 },
  { id: "languages", label: "语言能力", aliases: ["language"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 130 },
  { id: "publications", label: "论文与出版物", aliases: ["publication", "papers"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 140 },
  { id: "patents", label: "专利", aliases: ["patent"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 150 },
  { id: "portfolio", label: "作品集", aliases: ["works", "showcase"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 160 },
  { id: "other", label: "其他内容", aliases: ["additional", "miscellaneous"], repeatable: true, defaultVisible: false, addable: true, displayOrder: 170 },
  { id: "custom", label: "自定义栏目", aliases: [], repeatable: true, defaultVisible: false, addable: true, displayOrder: 180 }
] as const satisfies readonly ResumeSectionDefinition[];

export const resumeSectionById = new Map<ResumeSectionTypeV2, ResumeSectionDefinition>(
  resumeSectionCatalog.map((section) => [section.id, section])
);

export function getResumeSectionDefinition(sectionType: ResumeSectionTypeV2) {
  const definition = resumeSectionById.get(sectionType);
  if (!definition) throw new Error(`Unknown resume section: ${sectionType}`);
  return definition;
}
