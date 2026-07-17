# P3.6g0 统一简历数据契约与导入修复

## 正式契约

正式读写继续使用 `careeradapt-resume-v2`、`career-profile-v2`、`resume-branch-v2` 与 `resume-render-v2`。旧 `structured-resume-draft-v1` 只在 adapter 入口读取；导入确认、Revision、Studio、岗位分支、模板和 JSON/PDF 导出均保留 `ResumeItemV2`。

本轮未新增 Dexie 表、未修改 Fact Guard 阈值、未重写历史 Revision。新 Revision 增加可选 `structuredContentItems` 快照；旧快照缺少该字段时仍可读取，并在恢复后的正常读取/保存路径中升级。

## 模板兼容矩阵摘要

| AI 模板字段 | 正式落点 | 处理方式 |
| --- | --- | --- |
| `basics.summary` | `ResumeBasicsV2.summary` | 扩展兼容字段；旧资料读取时适配 |
| `basics.links` | `basics.otherLinks` | adapter 别名 |
| section `type` | `sectionType` | adapter 别名 |
| `publications.publication` | `publisher` | adapter 别名 |
| `portfolio.portfolioType` | `type` | adapter 别名 |
| `other.text` | `description` | adapter 别名 |
| custom field `displayOrder` | `order` | adapter 别名 |
| patent `role` | `customFields` | 无稳定通用语义，保留为自定义字段 |
| `project.location` | 既有 Schema 字段 | 补入 field catalog |

字段目录提升为 `resume-field-catalog-v2.1.0`。完整脱敏示例覆盖全部正式栏目和字段，删除占位符后必须通过真实 Zod Schema。合法未知字段通过 `customFields` 或 custom section 保留；模板统一提供 plain fallback 和兼容 warning，不静默删除。

## 结构不变量

导入确认前统一检查 generic experience、重复 section/item id、孤立日期、一源多目标冲突、已映射内容重复进入未分类、展示分组标题泄漏。失败时阻止提交并保留来源。

正式模板只遍历 `structuredSections`；所有栏目使用同级 heading，同一 item id 只渲染一次。旧 `experience/projects/language` 仅保留在读取兼容别名和 legacy fixture 中。

## 黄金样本（不提交正文）

- CareerAdapt 模板 PDF：summary 1、education 1、work 2、project 4、awards 2、skills 6、languages 1、未分类 0。
- 示例用户 AI 训练师 PDF：顶部简介进入 `basics.summary`；education 1、work 2、project 4、awards 2、skills 2 个语义组、languages 1、summary section 1；仅展示标签 `AI | PROMPT | EVAL` 保留为 1 条人工核对来源。
- `示例大学` 不拆地点；`示例任务系统 / TaskAI` 保留在项目标题；年月日期绑定对应 item，硬换行恢复后再拆 highlights。

真实私有 PDF、JSON、OCR 正文和个人信息不进入仓库。
