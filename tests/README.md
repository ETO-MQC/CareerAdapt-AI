# Tests Directory

当前测试按用途集中放置：

- `tests/unit/`：单元测试和 Repository、Schema、导入、渲染等核心规则测试。
- `tests/e2e/`：默认参与 Playwright 回归的端到端测试。
- `tests/ai-real/`：需要真实模型或兼容服务的可选联调测试。
- `tests/c1-eval/`、`tests/c2-eval/`：AI辅助验收与安全评估体系。
- `tests/fixtures/`：默认回归需要的固定 fixture。

本地临时验收用例、生成型测试用例和一次性 PDF fixture 不进 Git，统一放到 `.gitignore` 中声明的 `tests/local-cases/` 或 `tests/generated-cases/`。已经存在的本地 E1 黑盒验收用例和生成 PDF fixture 也已在 `.gitignore` 中保持本地化。
