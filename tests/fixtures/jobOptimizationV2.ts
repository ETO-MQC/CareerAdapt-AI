export const jobOptimizationV2GoldenCases = [
  {
    id: "ai-engineer", rawJd: "岗位职责\n设计模型输出质量评测体系\n任职要求\n熟悉 Python\n至少 3 年 AI 工程经验",
    expectedRequirements: ["质量评测体系", "Python", "3 年"], expectedDirectMatches: ["Python"],
    expectedTransferableMatches: ["质量评测体系"], expectedHardGaps: ["3 年"], forbiddenSuggestions: ["拥有三年经验", "负责完整企业评测平台"]
  },
  {
    id: "frontend", rawJd: "岗位职责\n负责 React 与 TypeScript 前端开发\n任职要求\n熟悉 Next.js",
    expectedRequirements: ["React", "TypeScript", "Next.js"], expectedDirectMatches: ["React", "TypeScript", "Next.js"],
    expectedTransferableMatches: [], expectedHardGaps: [], forbiddenSuggestions: ["提升 999%", "精通所有前端框架"]
  },
  {
    id: "supply-chain", rawJd: "岗位职责\n负责海外供应链与英语客户沟通\n必备条件\n持有报关证书",
    expectedRequirements: ["海外供应链", "英语客户沟通", "报关证书"], expectedDirectMatches: [],
    expectedTransferableMatches: [], expectedHardGaps: ["报关证书"], forbiddenSuggestions: ["持有报关证书", "多年外贸经验"]
  },
  {
    id: "unrelated-nursing", rawJd: "必备条件\n持有注册护士证\n至少 5 年 ICU 临床经验\n加分项\n具备急救培训经验",
    expectedRequirements: ["注册护士证", "5 年", "急救培训"], expectedDirectMatches: [], expectedTransferableMatches: [],
    expectedHardGaps: ["注册护士证", "5 年"], forbiddenSuggestions: ["注册护士", "ICU 临床工作"]
  }
] as const;
