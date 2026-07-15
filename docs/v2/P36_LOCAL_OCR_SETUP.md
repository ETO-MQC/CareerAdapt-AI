# P3.6 本地 PaddleOCR-VL 配置

## 1. 定位

本地 OCR 是扫描 PDF、图片简历和无可用文本层 PDF 的实验路径。正常数字 PDF 默认使用 PDF.js 坐标恢复，不执行 OCR。

运行时分为两层：

```text
浏览器
→ Next.js /api/resume-import/ocr
→ 仅 localhost 的 Python sidecar
→ PaddleOCR-VL-1.6 本地模型
```

OCR 只生成 `ImportedResumeDraft v2` 核对草稿，不直接写 CareerProfile、ResumeBranch 或 ResumeDocument。

## 2. 前置条件

- Python 3.10–3.12；本机验证使用 3.12.7。
- 与显卡/驱动匹配的 PaddlePaddle；本机验证为 `paddlepaddle-gpu==3.2.1` cu126。
- `paddleocr==3.7.0`、FastAPI、Uvicorn、python-multipart。
- 已存在的 PaddleOCR-VL-1.6 模型目录，目录下应有 `config.json`；不要复制或下载到 Git 仓库。
- GPU 模式建议显存明显高于实测约 7.9 GB 峰值；8 GB 设备余量很小。

官方项目：<https://github.com/PaddlePaddle/PaddleOCR>。

推荐在仓库外创建隔离环境。示例仅展示包边界，Paddle GPU wheel 必须按本机 CUDA/驱动选择：

```powershell
python -m venv C:\path\outside-repo\paddleocr-venv
& C:\path\outside-repo\paddleocr-venv\Scripts\python.exe -m pip install --upgrade pip
& C:\path\outside-repo\paddleocr-venv\Scripts\python.exe -m pip install paddleocr==3.7.0 fastapi uvicorn python-multipart
# 再按 Paddle 官方说明安装匹配设备的 paddlepaddle 或 paddlepaddle-gpu。
```

## 3. 环境变量

sidecar 进程需要：

```powershell
$env:PADDLEOCR_VL_MODEL_DIR='C:\path\to\PaddleOCR-VL-1.6'
$env:PADDLEOCR_VL_DEVICE='gpu'
$env:PADDLEOCR_VL_PORT='8765'
$env:PADDLEOCR_VL_TOKEN=[guid]::NewGuid().ToString('N')
```

Next.js 开发进程需要相同 token 和 localhost endpoint，可放入未提交的 `.env.local`：

```dotenv
PADDLEOCR_VL_ENDPOINT=http://127.0.0.1:8765
PADDLEOCR_VL_TOKEN=replace-with-the-same-local-random-token
```

`.env.example` 只能保留占位符。不要提交真实模型路径、token、缓存路径或本机用户名。

## 4. 启动

```powershell
& C:\path\outside-repo\paddleocr-venv\Scripts\python.exe scripts\paddleocr_vl_sidecar.py
```

sidecar 固定绑定 `127.0.0.1`，默认端口 8765；没有 Swagger/Redoc，access log 关闭。然后在另一个终端启动应用：

```powershell
pnpm dev
```

首次实际推理时模型延迟加载。Paddle 可能按 pipeline 配置下载额外的版面模型或字体；本机首次运行下载了约 131 MB 的 `PP-DocLayoutV3` 辅助模型。它不是第二份 PaddleOCR-VL 主权重，但仍应在部署前预热并纳入离线体积评估。

## 5. 健康检查

直接检查 sidecar：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

检查应用代理：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/resume-import/ocr
```

`ok=true` 只表示模型目录与运行时可用；第一次识别仍可能因显存、驱动、cuDNN 或辅助模型缺失失败。

## 6. 运行边界

- 接收 `application/pdf`、`image/png`、`image/jpeg`，最大 30 MB。
- Next Route health timeout 2.5 秒，识别 timeout 120 秒。
- 前端使用 AbortController 支持取消，显示页级进度；取消不会创建 Profile 或 Branch。
- sidecar 使用单个临时文件，`finally` 中逐文件删除；不批量删除目录。
- 服务器日志不写识别正文、姓名、电话、邮箱、地址、token 或模型绝对路径。
- sidecar 失败不会返回不完整草稿；已有确定性结果和原文件选择不应被清空。

## 7. 本机验证结果

- 模型加载约 12.6 秒。
- 加载后 GPU 显存约 7918 MB。
- 两份单页黄金 PDF 热推理约 37.0–37.8 秒。
- HTTP 端到端探针约 56.2 秒，返回 46 个来源块且 46 个含 bbox。
- 有 Paddle 编译 cuDNN 9.9、运行时 9.5 的警告；本机推理成功，但应视为环境风险，不应在生产部署中忽略。

PaddleOCR-VL 输出并非所有块都有可靠统一置信度。Adapter 缺失时使用保守默认 0.7，并要求用户确认；不要用该数值作为生产质量证明。

## 8. 常见故障与降级

| 症状 | 原因/处理 | 产品降级 |
| --- | --- | --- |
| `PADDLEOCR_VL_MODEL_DIR` 不可用 | 检查目录和 `config.json` | 显示未配置，允许重试/人工文本 |
| `/health` 不响应 | sidecar 未启动、端口冲突 | 显示本地 OCR 未响应 |
| 401 | Next 与 sidecar token 不一致 | 不发送文件，提示配置错误 |
| 413/415 | 文件过大或格式不支持 | 阻止调用，保留当前选择 |
| 502 | 模型、显存或 pipeline 失败 | 不保存不完整 OCR，允许重试 |
| 504 | 超过 120 秒 | 取消当前请求，不创建正式数据 |
| GPU OOM | 8 GB 显存余量不足或并发 | 关闭其他 GPU 任务、改设备配置或人工核对 |

任何降级都不得把低可信 OCR 内容直接写入正式简历，也不得为了减少 unclassified 强制错误映射。

## 9. 停止与清理

正常在 sidecar 终端使用 Ctrl+C。若以后台进程启动，只停止明确 PID；不要递归删除 venv、模型或缓存目录。临时上传文件由 sidecar 每次请求结束后单文件清理。

## 10. 后续在线 Adapter

未来百度千帆 Adapter 应实现同一个 `ResumeOcrAdapter`：

- `healthCheck()`；
- `recognizeDocument()`；
- `getEngineInfo()`；
- timeout、cancel、progress；
- 严格 OCR Schema 和相同来源验证。

在线结果仍只能进入核对草稿，不能新建绕过 Repository/Fact Guard 的写入路径。
