/** Scripted Provider behavior baseline, independent of the forty mapped safety oracles. */
export const core02BehaviorCases = [
  { id: "intent-greeting", category: "intent", text: "你好", tools: [], terminal: "你好" },
  { id: "intent-advice", category: "intent", text: "大学生找工作应该怎么准备？", tools: [], terminal: "你好" },
  { id: "material-certificate", category: "material", text: "P512-MATERIAL 把这个证书整理到资料库", tools: ["career.workflow.material_intake", "career.workflow.material_intake"], terminal: "已生成候选资料" },
  { id: "material-resume", category: "material", text: "P51-C02-MATERIAL 整理这份职业材料", tools: ["career.workflow.material_intake", "career.workflow.material_intake"], terminal: "已生成候选资料" },
  { id: "job-analyze", category: "job", text: "P51-BHV-ANALYZE CORE-JD 只分析这个岗位，不保存", tools: ["career.workflow.job_intake"], terminal: "岗位解析已完成" },
  { id: "job-cancel", category: "job", text: "CORE-JD 保存这个岗位", tools: ["career.workflow.job_intake"], cancel: true },
  { id: "resume-create", category: "resume", source: true, text: "P51-C02-COMPOSE 用我的资料库生成一份通用简历", tools: ["career.resume.list", "career.profile.get", "career.workflow.compose_resume"], terminal: "C02COMPOSEREADY" },
  { id: "resume-update", category: "resume", source: true, text: "P51-C02-COMPOSE UPDATE 用我的资料库更新通用简历", tools: ["career.resume.list", "career.profile.get", "career.workflow.compose_resume"], terminal: "C02COMPOSEREADY" },
  { id: "fit-existing-job", category: "fit_tailoring", source: true, savedJob: true, text: "P51-C02-FIT 这个岗位适合我吗？", tools: ["career.resume.list", "career.job.list", "career.workflow.job_fit"], terminal: "C02FITCOMPLETE" },
  { id: "tailor-followup", category: "fit_tailoring", source: true, savedJob: true, text: "P51-C02-TAILOR 那按它帮我改简历，别改模板", tools: ["career.resume.list", "career.job.list", "career.workflow.tailor_resume"], terminal: "C02TAILORREADY" },
  { id: "recovery-wrong-profile", category: "recovery", source: true, text: "P51-BHV-STALE 读取这个已失效目标", tools: ["career.profile.get"], expectedFailure: true },
  { id: "recovery-provider", category: "recovery", text: "P51-BHV-PROVIDER-FAIL 你好", tools: [], expectedFailure: true }
] as const;
