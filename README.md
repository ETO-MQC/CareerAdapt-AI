# CareerAdapt AI

CareerAdapt AI（职适AI）是面向大学生、应届生和职业早期用户的本地优先求职材料工作台。产品以可追溯的 CareerProfile 为事实来源，支持从简历文件或自然对话整理职业资料，并从同一资料库生成彼此隔离的通用简历与岗位简历。

当前版本：`0.9.3-rc.1`（Beta Core Release Candidate）

## Beta 支持能力

- 导入 PDF、DOCX、标准 JSON 和受支持的外部 JSON，核对来源后写入 CareerProfile。
- 通过自然对话整理经历候选；未经确认或尚未完成语义整理的内容不会进入正式资料库。
- 对重复、来源扩展、兼容更新和冲突执行显式 reconciliation。
- 从同一 CareerProfile 创建通用简历与多个岗位分支，保留 revision、factRefs、jobId 和来源关系。
- 基于岗位要求生成有事实依据的定制建议，并经 Fact Guard 与人工确认后应用。
- 预览并导出带文本层的 PDF，执行渲染覆盖和分页完整性检查。
- 在浏览器本地持久化 Profile、岗位、简历分支、任务状态、待处理决定和导出快照。

## 已知限制

- 本项目仍处于 Beta RC；不应在尚未完成实际 Golden Journey 验收时用于不可恢复的正式求职材料流程。
- AI 能力需要配置兼容 Provider。Provider 不可用时会保留原始证据并降级为人工核对，不会把未整理文本直接写入 CareerProfile。
- 扫描件 OCR 依赖可选的本地 PaddleOCR-VL sidecar；未配置时会提示改用文本层文件或人工核对。
- 复杂 PDF、浮动 DOCX 文本框和高度视觉化版式可能需要人工校对。
- 当前主要面向桌面浏览器；完整浏览器矩阵、外部 AI 和 OCR 不属于基础确定性 CI。

## 启动方式

环境要求：

- Node.js `>=20.9.0`
- pnpm `10.29.2`

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:3000`。

如需真实 AI Provider，在服务端环境配置：

```bash
AI_PROVIDER=openai-compatible
AI_MODEL=your-model
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-secret
```

不要把 API key 写入前端代码或提交到仓库。

## 验证方式

基础确定性门禁：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

等价快捷命令：

```bash
pnpm verify
```

专项验证：

```bash
pnpm test:c1:eval
pnpm test:c2:eval
pnpm test:e2e
pnpm test:ai:real
```

`test:ai:real` 只用于显式的 RC smoke/eval，不是普通提交门禁，也不得在日志中记录敏感正文。
