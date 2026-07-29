# P4.2a.4b Open-source reference audit

审计日期：2026-07-29。

本轮只借鉴产品原则、流程与核对 UX，没有复制或改写两个项目的源码、Prompt、模板或样式。

## MadsLorentzen/ai-job-search

- 上游：https://github.com/MadsLorentzen/ai-job-search
- 许可证：MIT（仓库 `LICENSE` 与 README License 区均标注 MIT）。
- 借鉴原则：
  - setup 同时支持已有文档、粘贴简历与自然访谈，入口按用户现有材料选择；
  - 资料先成为可复用 profile source，再进入岗位申请内容；
  - 外部发现或邮件状态只形成 proposal，用户批准后才写入权威记录；
  - 所有求职材料 claim 均需回到真实 profile，真实缺口保持可见；
  - 更新前预览影响范围，读后再写，避免覆盖个性化资料。
- CareerAdapt 落点：
  - Natural Conversation 先形成可恢复 Draft；
  - semantic result 是 proposal；
  - reconciliation 区分 additive、possible duplicate 与 conflict；
  - confirmation 后才通过 `WorkspaceRepository` 写回。

## srbhr/Resume-Matcher

- 上游：https://github.com/srbhr/Resume-Matcher
- 许可证：Apache License 2.0（仓库 `LICENSE`）。
- 借鉴原则：
  - master resume / career source 与具体岗位 tailoring 分离；
  - AI improvement 先 review，用户可修改建议；
  - 评分、模板与 PDF 是下游消费能力，不反向改变 master source 的事实；
  - 本地或远程 provider 可以替换，但 review contract 保持稳定。
- CareerAdapt 落点：
  - `CareerProfile` 保存 general career-ready data，不保存 JD-specific wording；
  - Rich Review 展示候选核心内容、来源与可信状态；
  - Resume/Tailoring 只消费确认后的通用资料。

## 引用与许可证处理

- 当前实现没有形成两个上游项目的 derivative code，不需要新增第三方源码 notice。
- 产品/架构文档以仓库链接和许可证名称进行原则性引用。
- 如果未来复制 Apache-2.0 源码，必须保留许可证、版权与 NOTICE 要求，并标记修改文件；如果复制 MIT 源码，必须保留版权和许可声明。

