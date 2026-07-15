# P3.6 PDF Parser 技术探针

## 1. 目的与样本

本探针比较：

1. 当前 PDF.js 对象顺序；
2. PDF.js 坐标行重建；
3. OpenDataLoader PDF `local/fast`；
4. 本地 PaddleOCR-VL-1.6。

样本 A 是 CareerAdapt 自身导出的全字段单页 PDF；样本 B 是外部复杂单页模板。原件和识别正文均保留在仓库外。指标只记录字符、数字、顺序、bbox、耗时和资源，不记录隐私字段。

环境：Windows、Node 24.15.0、Python 3.12.7、Java 23.0.2、RTX 4060 Laptop 8 GB。OpenDataLoader 与 PaddleOCR 均安装在仓库外的隔离 venv。

## 2. 数字 PDF 结果

### 2.1 PDF.js 坐标恢复

| 指标 | 样本 A | 样本 B |
| --- | ---: | ---: |
| 解析耗时 | 581 ms | 34 ms |
| 可见字符 | 2099 | 1536 |
| 数字 token | 22 | 51 |
| 替换字符 | 0 | 0 |
| 来源块 | 53 | 47 |
| bbox 覆盖 | 92.06% | 87.55% |
| 分类 | complex digital | digital |
| 检测列数 | 2 | 2 |

样本 B 的 PDF 内部对象顺序相对坐标布局的数字顺序 LCS 只有 0.569，证明不能直接依赖 `getTextContent().items` 存储顺序。坐标行重建是本轮正式路径。

### 2.2 OpenDataLoader local/fast

| 指标 | 样本 A | 样本 B |
| --- | ---: | ---: |
| 节点数 / 有 bbox 节点 | 25 / 25 | 50 / 50 |
| 可见字符 | 2098 | 1545 |
| 数字 token | 22 | 51 |
| 对 PDF.js 数字召回 | 1.000 | 1.000 |
| 数字顺序 LCS | 1.000 | 0.922 |

两文件一次 CLI 批处理总耗时约 1363 ms。脚本内 1–3 ms 的 JSON 读取时间不包含 Java CLI 启动，不能用来代表端到端耗时。

OpenDataLoader 仓库使用 Apache-2.0；本地 fast 模式需要 Java，Node 产品若正式采用还需要进程生命周期、部署体积、health、timeout、cancel 和失败降级。详见官方仓库：<https://github.com/opendataloader-project/opendataloader-pdf>。

### 2.3 采用决定

本轮不把 OpenDataLoader 设为默认生产解析器：

- 两份样本上，PDF.js 坐标恢复已保留全部关键数字；
- OpenDataLoader 在外部复杂样本的顺序更好，但优势不足以抵消浏览器产品额外 Java/Python sidecar 与分发成本；
- 当前正式实现没有新增生产依赖，离线可直接使用现有 PDF.js；
- 探针脚本 `scripts/p36-parser-benchmark.ts` 保留，未来有多页、表格和复杂文本框的脱敏基准后可重新评估。

这不是对 OpenDataLoader 能力的否定；它是本轮样本、部署边界和纵向 MVP 价值下的决定。

## 3. PaddleOCR-VL 结果

PaddleOCR-VL 使用已经存在的本地模型，没有下载第二份相同权重。首次初始化另行下载了版面辅助模型 `PP-DocLayoutV3`（约 131 MB）与字体缓存；这些文件均在仓库外。

| 指标 | 样本 A | 样本 B |
| --- | ---: | ---: |
| OCR 可见字符 | 1989 | 1909 |
| 文本层基线字符 | 2477 | 1824 |
| 字符量比例 | 0.803 | 1.047 |
| OCR 数字 token | 20 | 66 |
| 基线数字 token | 22 | 51 |
| 基线数字召回 | 0.909 | 1.000 |
| 数字顺序 LCS | 0.909 | 0.922 |
| 替换字符 | 0 | 0 |
| 热推理耗时 | 约 37.8 s | 约 37.0 s |

模型加载约 12.6 s，加载后 GPU 显存约 7918 MB。后续通过 HTTP sidecar 的正式块归一化探针返回 46/46 bbox，端到端约 56.2 s。

解释：样本 B OCR 数字 token 多于文本层基线，召回为 1.0 不代表精度为 1.0；可能包含版面序号、重复识别或额外数字。OCR 候选因此必须经过来源定位和用户确认，不能用单一召回率宣称质量完美。

## 4. 正式降级顺序

```text
标准数字 PDF
→ PDF.js 坐标行重建
→ 质量报告与人工核对

无可用文本层 / 扫描 PDF / 图片
→ 本地 PaddleOCR-VL
→ OCR 不可用或超时提示
→ 保留当前选择，允许重试或改用可复制文本
```

OpenDataLoader 当前只作为离线探针，不参与正式运行时降级链。

## 5. 可复现命令

Parser 指标脚本只输出统计，不输出正文：

```powershell
pnpm exec tsx scripts/p36-parser-benchmark.ts `<sample-a.pdf>` `<sample-b.pdf>`
```

真实文件必须保留在仓库外；不要把命令输出中的本地路径或任何 OCR 正文提交到 Git。

## 6. 限制

- 两份单页样本不足以代表所有多页简历、跨页表格、图标联系人和水印模板。
- pdftotext/PDF.js 字符数差异受空白和阅读顺序影响，不能单独作为字段正确率。
- 没有经人工双人标注的公开脱敏 expected fixture，因此字段 precision/recall 仍需后续授权样本补齐。
- OCR 资源与耗时来自单机单进程，不代表低显存设备、CPU-only 或并发服务表现。
