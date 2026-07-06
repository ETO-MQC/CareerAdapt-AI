# CareerAdapt AI

职适AI是面向大学生和应届生的岗位自适应简历与求职材料工作台。

## 快速启动

### 环境要求

- Node.js >= 18
- pnpm >= 8
- Windows 10/11, macOS 或 Linux

### 安装与启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发服务器
pnpm dev

# 3. 打开浏览器访问
# http://localhost:3000
```

### 验证安装

```bash
# 运行完整验证（类型检查、lint、单元测试、构建）
pnpm verify

# 运行 E2E 测试（需要先启动开发服务器）
pnpm test:e2e
```

### 常见问题

**Q: PDF.js 资源加载失败**
A: 确保 `public/pdfjs/` 目录存在且包含 worker、CMap 等资源文件。

**Q: E2E 测试超时**
A: 确保开发服务器已在 `http://localhost:3000` 运行，且端口未被占用。

**Q: 构建失败**
A: 运行 `pnpm typecheck` 检查类型错误，常见原因是导入路径大小写不一致。

## 文档入口

- V1 PRD：[`职适AI_产品需求文档_PRD_v1.0.md`](职适AI_产品需求文档_PRD_v1.0.md)
- V1计划档案：[`Plan.md`](Plan.md)
- V1开发历史：[`history.md`](history.md)
- V1交接摘要：[`docs/MVP_V1_HANDOFF.md`](docs/MVP_V1_HANDOFF.md)
- V2起始说明：[`docs/V2_START_HERE.md`](docs/V2_START_HERE.md)
- V2权威计划：[`plan2.md`](plan2.md)
- V2开发历史：[`history2.md`](history2.md)
- V2-G6a求职工作台：[`docs/v2/G6A_APPLICATION_WORKSPACE.md`](docs/v2/G6A_APPLICATION_WORKSPACE.md)

第二代开发以 `plan2.md` 和 `history2.md` 为准。`Plan.md` 与 `history.md` 只作为第一代 MVP 历史档案。
