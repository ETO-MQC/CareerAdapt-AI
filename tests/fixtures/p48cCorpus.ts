import { CareerProfileSchema } from "@/domain/schemas";

export const corpusBullets = {
  ai: "参与检索链路开发，使用混合检索与重排序处理文档查询，通过离线评测集验证召回。",
  backend: "参与订单服务开发，使用 Redis 缓存会话状态，通过 API 接口交付数据查询。",
  frontend: "参与会话页面开发，封装组件与状态管理，通过渲染测试验证交互复用。",
  infra: "参与部署流程开发，配置双机热备与健康检查，通过故障切换演练验证恢复。"
};

/** Synthetic source evidence; no corpus person's resume is copied. */
export function corpusProfile(bullets: string[] = Object.values(corpusBullets)) {
  const time = "2026-09-11T00:00:00.000Z";
  return CareerProfileSchema.parse({
    id: "p48c-profile", schemaVersion: "career-profile-v2", version: 1,
    createdAt: time, updatedAt: time, name: "校准候选人",
    basics: { name: "校准候选人", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] },
    experiences: bullets.map((statement, index) => ({
      id: `asset-${index}`, type: "project", organization: `验证项目${index}`, role: "项目成员",
      facts: [{ id: `fact-${index}`, statement, category: "experience", maturity: "demonstrated",
        confirmedByUser: true, riskLevel: "low", createdAt: time, updatedAt: time,
        provenance: [{ sourceType: "user_input", sourceId: `asset-${index}`, sourceText: statement,
          sourceQuote: statement, confirmedByUser: true, confidence: 1, riskLevel: "low", createdAt: time }]
      }], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: time, updatedAt: time
    })),
    skills: [], certificates: [], evidences: [], unclassifiedBlocks: [],
    structuredFacts: bullets.map((statement, index) => ({
      data: { id: `asset-${index}`, sectionType: "project", title: `验证项目${index}`, role: "项目成员",
        tools: [], highlights: [statement], outcomes: [], customFields: [] },
      factIds: [`fact-${index}`], sourceBlockIds: [], sourceRanges: [], mappingTrace: [], sourceExcerpt: statement
    }))
  });
}
