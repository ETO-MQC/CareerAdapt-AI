# P3.7 文档识别与本地模型设置

## 范围

本阶段只把 P3.6 已有 PDF.js、DOCX、PaddleOCR-VL 和 OpenDataLoader 技术探针产品化到设置与导入路线展示。没有重写 parser、修改 Resume Schema、接入百度千帆真实 API、下载模型权重或改变岗位/Studio。

## 持久化

文档识别偏好使用版本化 `localStorage` key：

```text
careeradapt.documentRecognition
```

保存字段：

- `parsingMode`
- `localOcrEnabled`
- `modelDirectory`
- `openDataLoaderExperimental`
- `allowManualRouteSelection`

不保存简历正文、OCR 输出、模型日志或在线识别 API key。没有新增 Dexie 表。

## 路由

```text
数字 PDF
-> PDF.js 坐标阅读顺序

扫描 PDF / 图片 / 损坏文本层
-> 本地 PaddleOCR-VL
-> 失败时回退已有文本层或人工核对

DOCX
-> 段落 / 标题 / 列表 / 表格结构解析

复杂数字 PDF + 用户启用实验开关
-> OpenDataLoader localhost sidecar
-> 失败自动回退 PDF.js
```

用户可在允许手动选择时改用文本解析、本地 OCR 或仅人工核对。OCR 结果仍进入 `ImportedResumeDraft` 核对与既有 Repository 提交边界。

## 健康检查

`POST /api/document-engines/health` 只执行轻量检查：

- PaddleOCR localhost sidecar `/health`
- 模型目录是否存在 `config.json`
- Python 版本
- OpenDataLoader 实验启用时的 localhost sidecar 与 Java

模型只在用户执行实际“测试识别”或导入 OCR 时由既有 sidecar 延迟加载。

默认目录候选来自：

- `PADDLEOCR_VL_MODEL_DIR`
- 用户目录下的通用 Paddle/PaddleOCR 缓存或 models 目录
- 可选 `PADDLEOCR_VL_MODEL_SEARCH_PATH`

代码不包含当前开发机绝对路径。

## OpenDataLoader

正式默认仍是 PDF.js。只有实验开关开启且数字 PDF 被判断为多栏或表格时，前端才调用同源实验 Adapter；Next Route 只允许代理到 localhost `OPENDATALOADER_ENDPOINT`，响应必须通过来源块 Schema。失败、超时或未配置均回退 PDF.js。

## 在线识别

`baiduQianfanRecognitionAdapter` 当前固定返回“尚未配置”，不发送文件、不请求或保存 API key。PaddleOCR-VL 是本地模型；百度千帆是在线 API 平台。
