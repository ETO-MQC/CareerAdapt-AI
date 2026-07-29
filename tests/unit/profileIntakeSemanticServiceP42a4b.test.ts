import { describe, expect, it } from "vitest";
import {
  ProfileIntakeSemanticService,
  type ProfileIntakeSemanticCandidate,
  type ProfileIntakeSemanticOutput
} from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { assessCareerAssetCompleteness } from "@/domain/profileIntake/ProfileIntakeCompleteness";

type Fixture = {
  name: string;
  narrative: string;
  proposals: ProfileIntakeSemanticCandidate[];
  expectedTypes: string[];
  expectedNames: string[];
};

const fixtures: Fixture[] = [
  fixture("企业实习", "2025年6月到8月，我在海岚物流做运营实习生，用 Excel 整理每日配送异常并协助客服核对原因。", [
    proposal("work-1", "internship", "海岚物流运营实习", "2025年6月到8月，我在海岚物流做运营实习生，用 Excel 整理每日配送异常并协助客服核对原因。", {
      organization: "海岚物流", role: "运营实习生", startDate: "2025-06", endDate: "2025-08",
      description: "使用 Excel 整理每日配送异常，并协助客服核对原因。", tools: ["Excel"]
    })
  ], ["internship"], ["海岚物流运营实习"]),
  fixture("行政学生工作", "我在北辰学院学生会秘书处做干事，整理会议纪要，也协调过活动教室。", [
    proposal("campus-1", "campus", "学生会秘书处", "我在北辰学院学生会秘书处做干事，整理会议纪要，也协调过活动教室。", {
      organization: "北辰学院学生会秘书处", role: "干事", description: "整理会议纪要并协调活动教室。"
    })
  ], ["campus"], ["学生会秘书处"]),
  fixture("非技术兼职", "周末在橙麦面包店兼职店员，主要补货、收银和处理顾客的普通咨询。", [
    proposal("parttime-1", "work", "橙麦面包店兼职", "周末在橙麦面包店兼职店员，主要补货、收银和处理顾客的普通咨询。", {
      organization: "橙麦面包店", role: "兼职店员", description: "负责补货、收银并处理顾客日常咨询。"
    })
  ], ["work"], ["橙麦面包店兼职"]),
  fixture("科研", "在云杉生物材料实验室参与海藻膜实验，用 Origin 绘制拉伸数据图，我只负责数据整理，没有设计实验。", [
    proposal("research-1", "research", "海藻膜实验数据整理", "在云杉生物材料实验室参与海藻膜实验，用 Origin 绘制拉伸数据图，我只负责数据整理，没有设计实验。", {
      institution: "云杉生物材料实验室", role: "数据整理", description: "参与海藻膜实验的数据整理，使用 Origin 绘制拉伸数据图。", methods: ["Origin"]
    })
  ], ["research"], ["海藻膜实验数据整理"]),
  fixture("志愿", "去年在青禾社区做暑期志愿者，给老人讲手机挂号的操作，还帮忙登记现场问题。", [
    proposal("volunteer-1", "volunteer", "青禾社区暑期志愿服务", "去年在青禾社区做暑期志愿者，给老人讲手机挂号的操作，还帮忙登记现场问题。", {
      organization: "青禾社区", role: "暑期志愿者", description: "讲解手机挂号操作并协助登记现场问题。"
    })
  ], ["volunteer"], ["青禾社区暑期志愿服务"]),
  fixture("编程项目", "做了一个叫 TideNote 的离线笔记工具，我用 Rust 写本地索引，用 Tauri 做桌面界面。", [
    proposal("project-1", "project", "TideNote", "做了一个叫 TideNote 的离线笔记工具，我用 Rust 写本地索引，用 Tauri 做桌面界面。", {
      description: "开发离线笔记工具，使用 Rust 实现本地索引，并使用 Tauri 构建桌面界面。", tools: ["Rust", "Tauri"]
    })
  ], ["project"], ["TideNote"]),
  fixture("商业分析", "课程里给山岚咖啡做门店分析，用 SQL 整理订单，再用 Tableau 看时段分布，最后交了一份选址建议。", [
    proposal("analysis-1", "project", "山岚咖啡门店分析", "课程里给山岚咖啡做门店分析，用 SQL 整理订单，再用 Tableau 看时段分布，最后交了一份选址建议。", {
      organization: "山岚咖啡", description: "使用 SQL 整理订单并通过 Tableau 分析时段分布。", tools: ["SQL", "Tableau"], outcomes: ["交付门店选址建议。"]
    })
  ], ["project"], ["山岚咖啡门店分析"]),
  fixture("竞赛", "2024年11月参加启明杯市场调研赛，我们团队拿到华东赛区二等奖，我负责问卷清洗。", [
    proposal("award-1", "awards", "启明杯华东赛区二等奖", "2024年11月参加启明杯市场调研赛，我们团队拿到华东赛区二等奖，我负责问卷清洗。", {
      name: "启明杯华东赛区二等奖", awardedAt: "2024-11", description: "团队获得华东赛区二等奖；本人负责问卷清洗。"
    })
  ], ["awards"], ["启明杯华东赛区二等奖"]),
  fixture("证书技能", "我有星云云计算基础证书，2025年3月拿到；平时会用 Power BI 做基础报表，但谈不上熟练。", [
    proposal("certificate-1", "certificates", "星云云计算基础证书", "我有星云云计算基础证书，2025年3月拿到", {
      name: "星云云计算基础证书", awardedAt: "2025-03"
    }),
    proposal("skill-1", "skills", "Power BI", "平时会用 Power BI 做基础报表，但谈不上熟练。", {
      name: "Power BI", description: "可使用 Power BI 制作基础报表。", needsConfirmation: false
    })
  ], ["certificates", "skills"], ["星云云计算基础证书", "Power BI"]),
  fixture("英文混合", "At Blue Harbor Studio, I worked as a content assistant and used Notion to maintain the weekly publishing calendar，没有负责整体运营。", [
    proposal("bilingual-1", "work", "Blue Harbor Studio content support", "At Blue Harbor Studio, I worked as a content assistant and used Notion to maintain the weekly publishing calendar，没有负责整体运营。", {
      organization: "Blue Harbor Studio", role: "content assistant", description: "Maintained the weekly publishing calendar in Notion as a content assistant.", tools: ["Notion"]
    })
  ], ["work"], ["Blue Harbor Studio content support"]),
  fixture("极度口语", "嗯就是之前吧，我在那个松果书店，差不多做了俩月，主要就是把新书上架，还有盘点，别的也没啥。", [
    proposal("colloquial-1", "work", "松果书店店务兼职", "嗯就是之前吧，我在那个松果书店，差不多做了俩月，主要就是把新书上架，还有盘点，别的也没啥。", {
      organization: "松果书店", description: "负责新书上架与库存盘点。", needsConfirmation: true
    })
  ], ["work"], ["松果书店店务兼职"]),
  fixture("语音纠错", "我在远山，不对，是远帆咨询做过助理，时间大概是去年七月，帮忙整理访谈记录；不是我访谈客户。", [
    proposal("correction-1", "internship", "远帆咨询助理", "我在远山，不对，是远帆咨询做过助理，时间大概是去年七月，帮忙整理访谈记录；不是我访谈客户。", {
      organization: "远帆咨询", role: "助理", description: "协助整理访谈记录。", needsConfirmation: true
    })
  ], ["internship"], ["远帆咨询助理"])
];

describe("P4.2a.4b general semantic career intake", () => {
  it.each(fixtures)("$name recognizes entirely new identities without production name rules", async (fixture) => {
    const service = serviceReturning({ candidates: fixture.proposals });
    const result = await service.normalize({ rawNarrative: fixture.narrative });

    expect(result.mode, result.warning).toBe("ai");
    expect(result.candidates.map((candidate) => candidate.normalization.sectionType)).toEqual(fixture.expectedTypes);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(fixture.expectedNames);
    expect(result.candidates.every((candidate) =>
      fixture.narrative.includes(candidate.sourceQuote)
      && candidate.normalization.fieldEvidence.every((evidence) => fixture.narrative.includes(evidence.sourceQuote))
    )).toBe(true);
  });

  it("structures multiple candidates from one long natural answer", async () => {
    const selected = [fixtures[0], fixtures[5], fixtures[7]];
    const narrative = selected.map((fixture) => fixture.narrative).join("\n");
    const proposals = selected.flatMap((fixture) => fixture.proposals.map((item) => ({
      ...item,
      fieldEvidence: item.fieldEvidence.map((evidence) => ({ ...evidence, sourceQuote: item.sourceQuote }))
    })));
    const result = await serviceReturning({ candidates: proposals }).normalize({ rawNarrative: narrative });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.normalization.sectionType)).toEqual(["internship", "project", "awards"]);
  });

  it("rejects responsibility upgrades and preserves the raw narrative as fallback", async () => {
    const narrative = "我协助青石团队整理客户反馈。";
    const unsafe = proposal("unsafe", "work", "青石团队客户反馈", narrative, {
      organization: "青石团队",
      description: "主导客户反馈体系建设。"
    });
    const result = await serviceReturning({ candidates: [unsafe] }).normalize({ rawNarrative: narrative });

    expect(result.mode).toBe("deterministic");
    expect(result.candidates[0].normalization.needsNormalization).toBe(true);
    expect(result.candidates[0].sourceQuote).toBe(narrative);
    expect(result.candidates[0].normalization.normalizedText).not.toContain("主导");
  });

  it("keeps raw input when the provider fails and does not claim AI normalization", async () => {
    const narrative = "我在新公司做过一段现在还没整理好的经历。";
    const service = new ProfileIntakeSemanticService(async () => ({ ok: false, errorCode: "provider_unavailable" }));
    const result = await service.normalize({ rawNarrative: narrative });

    expect(result).toMatchObject({ mode: "deterministic", providerStatus: "failed" });
    expect(result.warning).toContain("AI 语义整理暂不可用");
    expect(result.candidates[0]).toMatchObject({ sourceQuote: narrative });
  });

  it("uses deterministic utility rules and asks only the highest-value question", () => {
    const item = fixtures[1].proposals[0];
    return serviceReturning({ candidates: [item] }).normalize({ rawNarrative: fixtures[1].narrative }).then((result) => {
      const assessment = assessCareerAssetCompleteness(result.candidates[0].normalization.structuredItem);
      expect(assessment.nextQuestion).toBeTruthy();
      expect(result.followUpQuestion).toBe(assessment.nextQuestion);
      expect(result.followUpQuestion).not.toContain("？；");
    });
  });
});

function fixture(
  name: string,
  narrative: string,
  proposals: ProfileIntakeSemanticCandidate[],
  expectedTypes: string[],
  expectedNames: string[]
): Fixture {
  return { name, narrative, proposals, expectedTypes, expectedNames };
}

function proposal(
  candidateKey: string,
  sectionType: ProfileIntakeSemanticCandidate["sectionType"],
  label: string,
  sourceQuote: string,
  values: Partial<ProfileIntakeSemanticCandidate>
): ProfileIntakeSemanticCandidate {
  const nameSections = new Set(["awards", "skills", "certificates", "languages"]);
  const title = nameSections.has(sectionType) ? values.title : label;
  const name = nameSections.has(sectionType) ? label : values.name;
  const evidenceFields = [
    title ? "title" : undefined,
    name ? "name" : undefined,
    values.organization ? "organization" : undefined,
    values.institution ? "institution" : undefined,
    values.role ? "role" : undefined,
    values.description ? "description" : undefined,
    values.tools?.length ? "tools" : undefined,
    values.methods?.length ? "methods" : undefined,
    values.outcomes?.length ? "outcomes" : undefined,
    values.startDate ? "startDate" : undefined,
    values.endDate ? "endDate" : undefined,
    values.awardedAt ? "awardedAt" : undefined
  ].filter((field): field is string => Boolean(field));
  return {
    candidateKey,
    sectionType,
    title,
    name,
    organization: values.organization,
    institution: values.institution,
    role: values.role,
    startDate: values.startDate,
    endDate: values.endDate,
    current: values.current ?? false,
    awardedAt: values.awardedAt,
    description: values.description,
    highlights: values.highlights ?? [],
    tools: values.tools ?? [],
    methods: values.methods ?? [],
    outcomes: values.outcomes ?? [],
    sourceQuote,
    confidence: values.confidence ?? 0.9,
    needsConfirmation: values.needsConfirmation ?? false,
    fieldEvidence: evidenceFields.map((field) => ({
      field,
      sourceQuote,
      support: ["description", "highlights", "outcomes"].includes(field) ? "derived" : "explicit",
      confidence: 0.9,
      needsConfirmation: values.needsConfirmation ?? false
    }))
  };
}

function serviceReturning(output: ProfileIntakeSemanticOutput) {
  return new ProfileIntakeSemanticService(async () => ({ ok: true, data: output }));
}
