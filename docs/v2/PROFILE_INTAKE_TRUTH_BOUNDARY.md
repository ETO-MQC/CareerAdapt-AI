# Profile Intake Truth Boundary（P4.2a.4b.1）

## Beta Core 当前支持

General Semantic Career Intake 当前只承诺以下候选到 `ResumeItemV2` 的映射：

- `sectionType` → canonical item type。
- 用户明确给出的正式 identity（`title` / `name`）；AI 生成的职业化卡片标题必须标记为 `titleKind=derived_display`，只作为 review label，不冒充 hard identity。
- `startDate` / `endDate` / `current`；奖项使用 `awardedAt`。证书暂由 `awardedAt` 映射到 `issuedAt`。
- `organization` / `institution` / issuer-like organization。
- `role`；研究映射到 `authorRole`，教育当前映射到 `major`。
- `description` / `highlights`，前提是 deterministic Fact Guard 证明没有新增事实或责任升级。
- 项目的 `tools`，研究的 `methods`，作品集的 `tools`。
- 项目的 `outcomes`，包括经 grounded follow-up patch 后补。

每个字段的 evidence 必须位于对应 candidate 的 `sourceQuote` 内。Follow-up patch 的 hard field 必须由本轮补充证据或该 candidate 已有 authoritative field evidence 显式支持。

## Beta Core 明确暂缓

本阶段不宣称覆盖全部 Resume Schema v2 canonical fields。以下字段保持 deferred，不为“字段齐全”扩张 Intake：

- education：`degree`、独立的 `major` contract、`department`、`location`、GPA、rank、courses、honors。
- work / internship / campus / volunteer：`department`、`location`。
- project：`location`、`url`、`background`。
- research：`samples`、`publication`、`publicationStatus`、`url`。
- awards：独立的 `level`、`rank`。
- skills：`category`、`level`。
- certificates：`expiresAt`、`credentialId`、`status`。
- languages：`testName`、`score` 的 structured extraction。
- publications：authors、publishedAt、status、DOI、URL。
- patents：inventors、patentNumber、filedAt、grantedAt、status、URL。
- portfolio：type、URL、createdAt。
- custom fields 与任意 Schema 扩张。

## Fallback 边界

Provider failure 时，raw narrative 只保留在 Draft/raw evidence 与 provenance 中。Deterministic layer 可以提取月级日期到 `deterministicDatePatch`，但不会把未职业化 transcript 写成 normalized description。该 candidate 保持 `needsNormalization=true`、`needsConfirmation=true`，供用户重试 AI、编辑后采用或补充细节。

## Release source auditability

可复现 release source 必须包含 source、`pnpm-lock.yaml`、Vitest/Playwright/C1/C2 配置、相关 tests 与 fixtures。若另行发布不含 tests 的 public demo mirror，必须标记为 demo source snapshot，不得称为 reproducible release source。
