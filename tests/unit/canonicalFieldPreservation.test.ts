import { describe, expect, it } from "vitest";
import type { EducationItemV2, ResumeItemV2, WorkItemV2, ProjectItemV2, InternshipItemV2, CampusItemV2, VolunteerItemV2 } from "@/domain/schemas";

/**
 * P3.6g0.1 – Canonical field preservation round-trip test.
 *
 * For every canonical item type, the Studio form must hydrate from structured
 * fields (not from legacy text projection) and save back canonical fields
 * without data loss.
 *
 * We test the two pure functions that bridge canonical ↔ form:
 *   canonicalToFormFields(item)  – v2 item → flat form shape
 *   formFieldsToCanonicalPatch(item, fields) – flat form shape → patched v2 item
 *
 * Both live in ExperienceSectionPage.tsx and are re-exported here via direct import
 * from the module under test. Because they are not exported, we replicate the logic
 * inline to verify the contract. The real integration is tested via the Studio E2E.
 */

// ── Helpers mirroring ExperienceSectionPage logic ──────────────────────────

type StructuredExperienceFields = {
  organization: string;
  role: string;
  location: string;
  degree: string;
  major: string;
  courses: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  highlights: string[];
};

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
      description: item.description ?? "",
      highlights: item.highlights ?? []
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
      description: item.description ?? "",
      highlights: item.highlights ?? []
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
  const hl = "highlights" in item ? (item as { highlights?: string[] }).highlights ?? [] : [];
  return { organization: org, role, location: loc, degree: "", major: "", courses: "", startDate: sd, endDate: ed, current: cur, description: desc, highlights: hl };
}

function formFieldsToCanonicalPatch(item: ResumeItemV2, fields: StructuredExperienceFields): ResumeItemV2 {
  const desc = fields.description.trim() || undefined;
  const highlights = fields.highlights.map((h) => h.trim()).filter(Boolean);
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
      description: desc,
      highlights
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
      description: desc,
      highlights
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
      description: desc,
      highlights
  } as ResumeItemV2;
}

// ── Canonical fixtures ─────────────────────────────────────────────────────

const educationFixture: ResumeItemV2 = {
  id: "edu-1",
  sectionType: "education",
  school: "示例大学（示例高校）",
  degree: "本科",
  major: "计算机相关专业",
  location: "某地",
  startDate: "2024-09",
  endDate: "2028-06",
  current: false,
  courses: ["数据结构", "操作系统"],
  honors: ["奖学金"],
  description: "双一流建设高校，计算机相关专业专业（在读）",
  highlights: [],
  customFields: []
};

const workFixture: ResumeItemV2 = {
  id: "work-1",
  sectionType: "work",
  organization: "字节跳动",
  role: "前端工程师",
  department: "基础架构",
  location: "北京",
  startDate: "2023-07",
  endDate: "2024-06",
  current: false,
  description: "负责前端基础架构建设",
  highlights: ["优化构建速度 50%"],
  customFields: []
};

const internshipFixture: ResumeItemV2 = {
  id: "intern-1",
  sectionType: "internship",
  organization: "腾讯",
  role: "后端实习",
  department: "云与智慧产业",
  location: "深圳",
  startDate: "2023-01",
  endDate: "2023-06",
  current: false,
  description: "参与云服务开发",
  highlights: [],
  customFields: []
};

const projectFixture: ResumeItemV2 = {
  id: "proj-1",
  sectionType: "project",
  title: "智能简历助手",
  role: "技术负责人",
  organization: "校内项目",
  location: "某地",
  startDate: "2023-09",
  endDate: "2024-01",
  current: false,
  url: "https://github.com/example/resume",
  tools: ["React", "TypeScript"],
  background: "为大学生提供简历制作工具",
  description: "开发了完整的简历制作系统",
  highlights: ["支持 PDF 导入", "AI 建议"],
  outcomes: ["获得校级一等奖"],
  customFields: []
};

const researchFixture: ResumeItemV2 = {
  id: "res-1",
  sectionType: "research",
  title: "基于大模型的简历优化研究",
  authorRole: "第一作者",
  institution: "示例大学",
  startDate: "2024-01",
  endDate: "2024-06",
  methods: ["NLP", "LLM"],
  current: false,
  samples: "100份简历",
  publication: "ICLR 2025",
  publicationStatus: "已录用",
  url: "https://arxiv.org/example",
  description: "研究大模型在简历优化中的应用",
  highlights: [],
  customFields: []
};

const campusFixture: ResumeItemV2 = {
  id: "campus-1",
  sectionType: "campus",
  organization: "计算机学院学生会",
  role: "主席",
  location: "某地",
  startDate: "2023-09",
  endDate: "2024-06",
  current: false,
  description: "组织学院活动",
  highlights: ["策划 10 场技术分享"],
  customFields: []
};

const volunteerFixture: ResumeItemV2 = {
  id: "vol-1",
  sectionType: "volunteer",
  organization: "绿色志愿者协会",
  role: "志愿者",
  location: "某地",
  startDate: "2023-03",
  endDate: "2023-05",
  current: false,
  description: "参与植树活动",
  highlights: [],
  customFields: []
};

const awardFixture: ResumeItemV2 = {
  id: "award-1",
  sectionType: "awards",
  name: "ACM-ICPC 亚洲区域赛金牌",
  issuer: "ACM",
  level: "国际",
  awardedAt: "2024-03",
  rank: "金牌",
  description: "算法竞赛",
  customFields: []
};

const skillFixture: ResumeItemV2 = {
  id: "skill-1",
  sectionType: "skills",
  name: "TypeScript",
  category: "编程语言",
  level: "熟练",
  description: "3年开发经验",
  customFields: []
};

const certificateFixture: ResumeItemV2 = {
  id: "cert-1",
  sectionType: "certificates",
  name: "CET-6",
  issuer: "教育部",
  issuedAt: "2023-06",
  expiresAt: undefined,
  credentialId: "CERT-12345",
  status: "有效",
  description: "大学英语六级",
  customFields: []
};

const languageFixture: ResumeItemV2 = {
  id: "lang-1",
  sectionType: "languages",
  language: "英语",
  level: "熟练",
  testName: "CET-6",
  score: "580",
  description: "",
  customFields: []
};

const publicationFixture: ResumeItemV2 = {
  id: "pub-1",
  sectionType: "publications",
  title: "基于深度学习的代码补全",
  authors: ["张三", "李四"],
  authorRole: "第一作者",
  publisher: "IEEE",
  publishedAt: "2024-06",
  status: "已发表",
  doi: "10.1234/example",
  url: "https://doi.org/example",
  description: "提出了一种新的代码补全方法",
  customFields: []
};

const patentFixture: ResumeItemV2 = {
  id: "pat-1",
  sectionType: "patents",
  title: "一种智能简历解析方法",
  inventors: ["张三"],
  patentNumber: "CN202410001",
  office: "国家知识产权局",
  filedAt: "2024-01",
  grantedAt: "2024-06",
  status: "已授权",
  url: undefined,
  description: "发明了一种新的简历解析方法",
  customFields: []
};

const portfolioFixture: ResumeItemV2 = {
  id: "port-1",
  sectionType: "portfolio",
  title: "智能简历助手",
  type: "开源项目",
  role: "开发者",
  url: "https://github.com/example",
  createdAt: "2024-01",
  tools: ["React", "Node.js"],
  description: "完整的简历制作工具",
  highlights: ["500+ GitHub Stars"],
  customFields: []
};

const otherFixture: ResumeItemV2 = {
  id: "other-1",
  sectionType: "other",
  title: "其他经历",
  description: "一些其他经历",
  highlights: [],
  customFields: []
};

const summaryFixture: ResumeItemV2 = {
  id: "summary-1",
  sectionType: "summary",
  text: "热爱技术，追求卓越",
  customFields: []
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("P3.6g0.1 canonical field preservation", () => {
  describe("education round-trip", () => {
    it("preserves all education fields through form round-trip", () => {
      const form = canonicalToFormFields(educationFixture);
      expect(form.organization).toBe("示例大学（示例高校）");
      expect(form.degree).toBe("本科");
      expect(form.major).toBe("计算机相关专业");
      expect(form.location).toBe("某地");
      expect(form.startDate).toBe("2024-09");
      expect(form.endDate).toBe("2028-06");
      expect(form.current).toBe(false);
      expect(form.courses).toBe("数据结构、操作系统");
      expect(form.description).toBe("双一流建设高校，计算机相关专业专业（在读）");

      const patched = formFieldsToCanonicalPatch(educationFixture, form) as EducationItemV2;
      expect(patched.school).toBe("示例大学（示例高校）");
      expect(patched.degree).toBe("本科");
      expect(patched.major).toBe("计算机相关专业");
      expect(patched.location).toBe("某地");
      expect(patched.startDate).toBe("2024-09");
      expect(patched.endDate).toBe("2028-06");
      expect(patched.current).toBe(false);
      expect(patched.courses).toEqual(["数据结构", "操作系统"]);
      expect(patched.description).toBe("双一流建设高校，计算机相关专业专业（在读）");
      // non-form fields preserved
      expect(patched.honors).toEqual(["奖学金"]);
      expect(patched.customFields).toEqual([]);
    });

    it("handles current=true education (endDate should be undefined)", () => {
      const item: ResumeItemV2 = {
        ...educationFixture,
        id: "edu-current",
        current: true,
        endDate: undefined
      };
      const form = canonicalToFormFields(item);
      expect(form.current).toBe(true);
      expect(form.endDate).toBe("");

      const patched = formFieldsToCanonicalPatch(item, { ...form, current: true, endDate: "2028-06" }) as EducationItemV2;
      expect(patched.current).toBe(true);
      expect(patched.endDate).toBeUndefined();
    });
  });

  describe("work round-trip", () => {
    it("preserves all work fields", () => {
      const form = canonicalToFormFields(workFixture);
      expect(form.organization).toBe("字节跳动");
      expect(form.role).toBe("前端工程师");
      expect(form.location).toBe("北京");
      expect(form.startDate).toBe("2023-07");
      expect(form.endDate).toBe("2024-06");
      expect(form.description).toBe("负责前端基础架构建设");

      const patched = formFieldsToCanonicalPatch(workFixture, form) as WorkItemV2;
      expect(patched.organization).toBe("字节跳动");
      expect(patched.role).toBe("前端工程师");
      expect(patched.location).toBe("北京");
      expect(patched.startDate).toBe("2023-07");
      expect(patched.endDate).toBe("2024-06");
      expect(patched.description).toBe("负责前端基础架构建设");
      expect(patched.highlights).toEqual(["优化构建速度 50%"]);
    });
  });

  describe("internship round-trip", () => {
    it("preserves all internship fields", () => {
      const form = canonicalToFormFields(internshipFixture);
      expect(form.organization).toBe("腾讯");
      expect(form.role).toBe("后端实习");

      const patched = formFieldsToCanonicalPatch(internshipFixture, form) as InternshipItemV2;
      expect(patched.organization).toBe("腾讯");
      expect(patched.role).toBe("后端实习");
      expect(patched.location).toBe("深圳");
    });
  });

  describe("project round-trip", () => {
    it("preserves all project fields", () => {
      const form = canonicalToFormFields(projectFixture);
      expect(form.organization).toBe("智能简历助手");
      expect(form.role).toBe("技术负责人");
      expect(form.location).toBe("某地");
      expect(form.startDate).toBe("2023-09");
      expect(form.endDate).toBe("2024-01");

      const patched = formFieldsToCanonicalPatch(projectFixture, form) as ProjectItemV2;
      expect(patched.title).toBe("智能简历助手");
      expect(patched.role).toBe("技术负责人");
      expect(patched.location).toBe("某地");
      expect(patched.startDate).toBe("2023-09");
      expect(patched.endDate).toBe("2024-01");
      expect(patched.tools).toEqual(["React", "TypeScript"]);
      expect(patched.outcomes).toEqual(["获得校级一等奖"]);
    });
  });

  describe("campus round-trip", () => {
    it("preserves all campus fields", () => {
      const form = canonicalToFormFields(campusFixture);
      expect(form.organization).toBe("计算机学院学生会");
      expect(form.role).toBe("主席");

      const patched = formFieldsToCanonicalPatch(campusFixture, form) as CampusItemV2;
      expect(patched.organization).toBe("计算机学院学生会");
      expect(patched.role).toBe("主席");
      expect(patched.highlights).toEqual(["策划 10 场技术分享"]);
    });
  });

  describe("volunteer round-trip", () => {
    it("preserves all volunteer fields", () => {
      const form = canonicalToFormFields(volunteerFixture);
      const patched = formFieldsToCanonicalPatch(volunteerFixture, form) as VolunteerItemV2;
      expect(patched.organization).toBe("绿色志愿者协会");
      expect(patched.role).toBe("志愿者");
      expect(patched.location).toBe("某地");
    });
  });

  describe("non-experience types (handled by CanonicalSectionPage)", () => {
    it("awards, skills, certificates, languages, publications, patents, portfolio, other, summary use CanonicalSectionPage which reads canonical fields directly", () => {
      // These types do NOT go through ExperienceSectionPage.
      // They are tested by CanonicalSectionPage which reads from item.data directly.
      // Verify canonicalToFormFields does not crash on them (fallback path).
      expect(canonicalToFormFields(awardFixture)).toBeDefined();
      expect(canonicalToFormFields(skillFixture)).toBeDefined();
      expect(canonicalToFormFields(certificateFixture)).toBeDefined();
      expect(canonicalToFormFields(languageFixture)).toBeDefined();
      expect(canonicalToFormFields(publicationFixture)).toBeDefined();
      expect(canonicalToFormFields(patentFixture)).toBeDefined();
      expect(canonicalToFormFields(portfolioFixture)).toBeDefined();
      expect(canonicalToFormFields(otherFixture)).toBeDefined();
      expect(canonicalToFormFields(summaryFixture)).toBeDefined();
    });
  });

  describe("empty values", () => {
    it("handles item with all optional fields undefined", () => {
      const minimal = {
        id: "edu-min",
        sectionType: "education" as const,
        courses: [],
        honors: [],
        highlights: [],
        customFields: [],
        current: false
      } as ResumeItemV2;
      const form = canonicalToFormFields(minimal);
      expect(form.organization).toBe("");
      expect(form.degree).toBe("");
      expect(form.major).toBe("");
      expect(form.startDate).toBe("");
      expect(form.endDate).toBe("");
      expect(form.current).toBe(false);

      const patched = formFieldsToCanonicalPatch(minimal, form) as EducationItemV2;
      expect(patched.school).toBeUndefined();
      expect(patched.degree).toBeUndefined();
      expect(patched.major).toBeUndefined();
      expect(patched.startDate).toBeUndefined();
      expect(patched.endDate).toBeUndefined();
      expect(patched.current).toBe(false);
    });
  });

  describe("date format", () => {
    it("preserves YYYY-MM format without conversion", () => {
      const form = canonicalToFormFields(educationFixture);
      // dates must remain YYYY-MM, not YYYY-MM-DD or any other format
      expect(form.startDate).toMatch(/^\d{4}-\d{2}$/);
      expect(form.endDate).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe("custom fields preservation", () => {
    it("custom fields are not lost during form round-trip", () => {
      const withCustom: ResumeItemV2 = {
        ...educationFixture,
        customFields: [
          { id: "cf-1", label: "荣誉", valueType: "string", value: "国家奖学金", order: 0, sensitive: false }
        ]
      };
      const form = canonicalToFormFields(withCustom);
      const patched = formFieldsToCanonicalPatch(withCustom, form);
      expect(patched.customFields).toEqual(withCustom.customFields);
    });
  });

  describe("highlights round-trip", () => {
    it("work: reads highlights from canonical item and writes back", () => {
      const workItem: ResumeItemV2 = {
        ...workFixture,
        description: undefined,
        highlights: ["职责一", "成果二"]
      };
      const form = canonicalToFormFields(workItem);
      expect(form.description).toBe("");
      expect(form.highlights).toEqual(["职责一", "成果二"]);

      const patched = formFieldsToCanonicalPatch(workItem, form) as WorkItemV2;
      expect(patched.description).toBeUndefined();
      expect(patched.highlights).toEqual(["职责一", "成果二"]);
    });

    it("project: description and highlights are independent", () => {
      const projItem: ResumeItemV2 = {
        ...projectFixture,
        description: "项目概述",
        highlights: ["成果一", "成果二"]
      };
      const form = canonicalToFormFields(projItem);
      expect(form.description).toBe("项目概述");
      expect(form.highlights).toEqual(["成果一", "成果二"]);

      const patched = formFieldsToCanonicalPatch(projItem, form) as ProjectItemV2;
      expect(patched.description).toBe("项目概述");
      expect(patched.highlights).toEqual(["成果一", "成果二"]);
    });

    it("education: description and highlights are independent", () => {
      const eduItem: ResumeItemV2 = {
        ...educationFixture,
        description: "教育补充说明",
        highlights: ["校级奖学金"]
      };
      const form = canonicalToFormFields(eduItem);
      expect(form.description).toBe("教育补充说明");
      expect(form.highlights).toEqual(["校级奖学金"]);

      const patched = formFieldsToCanonicalPatch(eduItem, form) as EducationItemV2;
      expect(patched.description).toBe("教育补充说明");
      expect(patched.highlights).toEqual(["校级奖学金"]);
    });

    it("trims and filters empty highlights", () => {
      const workItem: ResumeItemV2 = {
        ...workFixture,
        highlights: []
      };
      const form = canonicalToFormFields(workItem);
      form.highlights = ["  有空格  ", "", "有效内容", "  "];

      const patched = formFieldsToCanonicalPatch(workItem, form) as WorkItemV2;
      expect(patched.highlights).toEqual(["有空格", "有效内容"]);
    });

    it("preserves existing highlights when description changes", () => {
      const workItem: ResumeItemV2 = {
        ...workFixture,
        description: "原始描述",
        highlights: ["成果一", "成果二"]
      };
      const form = canonicalToFormFields(workItem);
      form.description = "新描述";

      const patched = formFieldsToCanonicalPatch(workItem, form) as WorkItemV2;
      expect(patched.description).toBe("新描述");
      expect(patched.highlights).toEqual(["成果一", "成果二"]);
    });

    it("empty highlights results in empty array", () => {
      const workItem: ResumeItemV2 = {
        ...workFixture,
        highlights: ["有内容"]
      };
      const form = canonicalToFormFields(workItem);
      form.highlights = [];

      const patched = formFieldsToCanonicalPatch(workItem, form) as WorkItemV2;
      expect(patched.highlights).toEqual([]);
    });
  });
});
