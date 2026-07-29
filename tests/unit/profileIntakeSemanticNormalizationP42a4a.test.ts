import { describe, expect, it } from "vitest";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { ProfileIntakeNormalizer } from "@/domain/profileIntake/ProfileIntakeNormalizer";

const SOURCE = {
  sessionId: "session-semantic-normalization",
  messageId: "message-semantic-normalization",
  turnId: "turn-semantic-normalization",
  capturedAt: "2026-07-28T10:00:00.000Z"
};

describe("P4.2a.4a profile intake semantic normalization regressions", () => {
  it("persists an explicit month range in the structured project", () => {
    const { draft } = adaptConversationMessageToIntakeDraft({
      ...SOURCE,
      text: "Smart Focus - Task AI 是我全栈开发的桌面任务学习规划系统，2026.02-2026.05 完成 MVP。"
    });
    const project = draft.sections[0]?.items[0]?.structuredItem;

    expect(project).toMatchObject({
      sectionType: "project",
      startDate: "2026-02",
      endDate: "2026-05",
      current: false
    });
  });

  it("keeps raw source evidence while producing career-ready campus wording", () => {
    const raw = "社团学生组织，我是团支书，反正每个月都给学生们开团日活动，然后负责团务问题解答和社会实践等通知传达。";
    const { draft } = adaptConversationMessageToIntakeDraft({ ...SOURCE, text: raw });
    const item = draft.sections[0]?.items[0];

    expect(item?.sourceQuote).toContain("反正");
    expect(item?.normalizedText).not.toBe(item?.sourceQuote);
    expect(item?.structuredItem).toMatchObject({
      sectionType: "campus",
      role: "团支书",
      description: "担任团支书，负责班级团务组织与信息沟通。",
      highlights: [
        "每月组织团日活动。",
        "负责团务信息答疑及社会实践等活动通知传达。"
      ]
    });
  });

  it.each([
    ["ongoing", "开发 CareerAdapt AI 简历制作平台，2026.07-至今。", {
      sectionType: "project",
      startDate: "2026-07",
      current: true
    }],
    ["single award month", "2025.04 参加示例编程竞赛并获得某省 Python A 组省级三等奖。", {
      sectionType: "awards",
      awardedAt: "2025-04"
    }],
    ["approximate month", "2025.02 在课题组使用视觉模型和 Python 处理实验数据 PDF，大概做了一周。", {
      sectionType: "research",
      startDate: "2025-02"
    }]
  ])("normalizes %s without fabricating a day", (_, text, expected) => {
    const { draft } = adaptConversationMessageToIntakeDraft({ ...SOURCE, text });
    const structured = draft.sections[0]?.items[0]?.structuredItem;

    expect(structured).toMatchObject(expected);
    expect(JSON.stringify(structured)).not.toMatch(/2025-0[24]-\d{2}/);
  });

  it("preserves responsibility level while cleaning colloquial project wording", () => {
    const raw = "我协助开发心跳模块，然后协助将心跳模块、摔倒模块和蓝牙接入一块，摔倒模块一直叫，后来发现线接错了，调整走线后恢复正常。";
    const { draft } = adaptConversationMessageToIntakeDraft({ ...SOURCE, text: raw });
    const project = draft.sections[0]?.items[0]?.structuredItem;
    const wording = JSON.stringify(project);

    expect(wording).toContain("协助");
    expect(wording).not.toMatch(/主导|全部完成|性能提升|提升\d+%/);
    expect(draft.sections[0]?.items[0]?.sourceQuote).toContain("协助");
  });

  it.each([
    ["RAG/reg", "项目里好像使用的是 RAG/reg，需要再确认。"],
    ["uncertain document name", "使用视觉模型和 Python 处理近千页 PDF，文档可能是化疗单吧。"]
  ])("keeps %s uncertain and out of hard career wording", (_, sourceQuote) => {
    const result = new ProfileIntakeNormalizer().normalize({
      id: "uncertain-research",
      kind: "research",
      label: "实验数据 PDF 处理",
      sourceQuote,
      needsConfirmation: false
    });

    expect(result.needsConfirmation).toBe(true);
    expect(result.normalizedText).not.toMatch(/RAG\/reg|化疗单/iu);
    expect(result.fieldEvidence.some((item) => item.needsConfirmation || result.needsConfirmation)).toBe(true);
  });

  it("normalizes the eight real-fixture experience date shapes without leaking fillers", () => {
    const text = [
      "ESP32 心跳与摔倒检测课程项目，2026.05-2026.06，我协助心率模块、接线排查和蓝牙联调。",
      "示例编程竞赛某省 Python A 组省级三等奖，2025.04。",
      "实验室课题组使用视觉模型和 Python 处理实验数据 PDF，大概是 2025.02，约一周。",
      "我是团支书，反正每月组织团日活动并负责团务答疑和通知传达，2024.09-至今。",
      "Smart Focus - Task AI 是我全栈开发的桌面任务学习规划系统，2026.02-2026.04。",
      "LearnSome AI Tool，当然我知道这是一个学习辅助工具，2026.02-2026.05。",
      "示例内容分析系统，那个项目使用 RPA，2026.02-2026.05。",
      "CareerAdapt AI 简历制作平台，就是个职业资料工具，2026.07-至今。"
    ].join("\n");
    const { draft } = adaptConversationMessageToIntakeDraft({ ...SOURCE, text });
    const items = draft.sections.flatMap((section) => section.items);
    const by = (pattern: RegExp) => items.find((item) => pattern.test(item.itemLabel ?? ""));

    expect(by(/ESP32/)?.structuredItem).toMatchObject({ startDate: "2026-05", endDate: "2026-06", current: false });
    expect(by(/示例编程竞赛/)?.structuredItem).toMatchObject({ awardedAt: "2025-04" });
    expect(by(/视觉模型/)?.structuredItem).toMatchObject({ startDate: "2025-02" });
    expect(by(/团支书/)?.structuredItem).toMatchObject({ startDate: "2024-09", current: true });
    expect(by(/Smart Focus/)?.structuredItem).toMatchObject({ startDate: "2026-02", endDate: "2026-04", current: false });
    expect(by(/LearnSome/)?.structuredItem).toMatchObject({ startDate: "2026-02", endDate: "2026-05", current: false });
    expect(by(/示例内容/)?.structuredItem).toMatchObject({ startDate: "2026-02", endDate: "2026-05", current: false });
    expect(by(/CareerAdapt/)?.structuredItem).toMatchObject({ startDate: "2026-07", current: true });
    expect(items.map((item) => item.normalizedText).join("\n")).not.toMatch(/反正|那个|就是个|当然我知道|然后然后/);
    expect(items.map((item) => item.sourceQuote).join("\n")).toMatch(/反正|那个|就是个|当然我知道/);
  });
});
