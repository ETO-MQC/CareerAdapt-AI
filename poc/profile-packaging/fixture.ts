import type { ProfileSnapshot } from "../profile-plugin/read-client";

/** Display-only synthetic DTO. Not Resume Schema v2 or a Domain API. */
export const syntheticProfile: ProfileSnapshot = {
  id: "synthetic-profile-b2b2",
  name: "虚构同学·星舟",
  basics: [["name", "虚构同学·星舟"], ["email", "xingzhou@example.invalid"], ["phone", "虚构电话（不可拨打）"], ["location", "虚构星舟城"], ["headline", "完全合成资料 · 只读演示"]],
  sections: [
    { id: "education", label: "教育经历", items: [{ id: "synthetic-edu", title: "虚构星舟学院", subtitle: "虚构信息设计专业 · 2022–2026", body: "合成课程：界面设计、信息组织。" }] },
    { id: "work", label: "工作经历", items: [{ id: "synthetic-work", title: "虚构云帆实验室", subtitle: "合成体验研究助理 · 2025", body: "整理虚构访谈样本并制作演示界面。" }] },
    { id: "projects", label: "项目经历", items: [{ id: "synthetic-project", title: "虚构灯塔导航项目", subtitle: "合成团队项目", body: "为不存在的校园设计合成导航原型。" }] },
    { id: "awards", label: "奖项", items: [{ id: "synthetic-award", title: "虚构星云设计奖", subtitle: "合成赛事 · 2025", body: "演示奖项，无现实获奖事实。" }] },
    { id: "skills", label: "技能", items: [{ id: "synthetic-skill", title: "信息设计", subtitle: "合成技能", body: "用于展示只读字段，无真实能力声明。" }] },
    { id: "languages", label: "语言", items: [{ id: "synthetic-language", title: "虚构星语", subtitle: "合成语言", body: "完全虚构，用于验证语言板块。" }] }
  ]
};
