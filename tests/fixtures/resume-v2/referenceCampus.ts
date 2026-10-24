/** Anonymous fixture: comparable field shapes and density, no user resume content. */
export function referenceCampusResume() {
  const activity = "维护业务资料与处理记录，核对数据口径并及时反馈办理进度，支持团队完成跨部门协作。";
  return { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "林同学", phone: "13800000000", email: "candidate@example.com" }, sections: [
    { id: "edu", sectionType: "education", title: "教育背景", order: 0, items: [{ id: "edu1", sectionType: "education", school: "示例大学", degree: "本科", major: "统计学", startDate: "2023-09", endDate: "2027-06", gpa: 3.6, rankPercent: 15, honors: ["校级奖学金；优秀学生干部；校级统计实践竞赛二等奖"], courses: ["统计学", "计量分析", "Python 程序设计", "数据库应用"], highlights: [] }] },
    { id: "intern", sectionType: "internship", title: "实习经历", order: 1, items: [{ id: "intern1", sectionType: "internship", organization: "示例公共服务中心", department: "信息管理科", role: "综合事务助理", startDate: "2025-07", endDate: "2025-08", highlights: [activity.repeat(2), activity.repeat(2), "使用 SQL 查询台账，利用 Python 清洗记录，汇总处理结果。"] }] },
    { id: "campus", sectionType: "campus", title: "校园经历", order: 2, items: [{ id: "campus1", sectionType: "campus", organization: "校园创新实践活动", role: "志愿者协调", highlights: [activity] }, { id: "campus2", sectionType: "campus", role: "班长", highlights: [activity] }] },
    { id: "training", sectionType: "training", title: "培训经历", order: 3, items: [{ id: "training1", sectionType: "training", institution: "示例培训机构", startDate: "2026-07-01", endDate: "2026-09-01", description: "完成数据库部署、备份恢复与查询实操，依据训练材料复核操作过程。" }] },
    { id: "skills", sectionType: "skills", title: "专业技能", order: 4, items: [{ id: "skill1", sectionType: "skills", name: "Excel", level: "熟练", description: "高级函数与数据透视表" }, { id: "skill2", sectionType: "skills", name: "Python", description: "Pandas 数据清洗" }, { id: "skill3", sectionType: "skills", name: "SQL", description: "查询与校验" }] },
    { id: "certificates", sectionType: "certificates", title: "证书", order: 5, items: [{ id: "cert1", sectionType: "certificates", name: "CET6" }, { id: "cert2", sectionType: "certificates", name: "数据库应用认证" }] },
    { id: "summary", sectionType: "summary", title: "自我评价", order: 6, items: [{ id: "summary1", sectionType: "summary", text: "统计学本科在读，熟练使用 Excel 高级函数与数据透视表，掌握 Python Pandas 数据清洗，使用 SQL 查询与校验。" + activity.repeat(3) }] }
  ] };
}
