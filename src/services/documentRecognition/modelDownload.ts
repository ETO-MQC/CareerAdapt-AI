import { createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID,
  getDocumentRecognitionModelOption
} from "@/domain/documentRecognition/modelCatalog";
import type { DocumentRecognitionModelId } from "@/domain/schemas";

export const PADDLEOCR_VL_MODEL_REPOSITORY = "PaddlePaddle/PaddleOCR-VL-1.6";
const MODEL_DIRECTORY_NAMES: Record<DocumentRecognitionModelId, string> = {
  official_paddle_bf16: "PaddleOCR-VL-1.6",
  hf_int8_safetensors: "PaddleOCR-VL-1.6-HF-INT8",
  hf_int4_openvino: "PaddleOCR-VL-1.6-OpenVINO-INT4",
  official_gguf_bf16: "PaddleOCR-VL-1.6-GGUF-BF16",
  gguf_q4_k_m: "PaddleOCR-VL-1.6-GGUF-Q4_K_M",
  gguf_q5_k_m: "PaddleOCR-VL-1.6-GGUF-Q5_K_M",
  gguf_q6_k: "PaddleOCR-VL-1.6-GGUF-Q6_K",
  gguf_q8_0: "PaddleOCR-VL-1.6-GGUF-Q8_0"
};
const MAX_MODEL_BYTES = 8 * 1024 * 1024 * 1024;

type ModelFile = {
  path: string;
  size: number;
};

type DownloadDocumentModelOptions = {
  modelId?: DocumentRecognitionModelId;
  signal?: AbortSignal;
};

export function defaultPaddleOcrModelDirectory() {
  return defaultDocumentModelDirectory(DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID);
}

export function defaultDocumentModelDirectory(modelId: DocumentRecognitionModelId) {
  const configured = process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR?.trim();
  if (configured && modelId === DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID) return resolve(configured);
  const dataRoot = process.env.CAREERADAPT_OCR_DATA_DIR?.trim();
  return resolve(dataRoot || join(homedir(), ".cache", "careeradapt-ai", "ocr"), MODEL_DIRECTORY_NAMES[modelId]);
}

export async function downloadPaddleOcrVlModel(options: DownloadDocumentModelOptions = {}) {
  const modelId = options.modelId ?? DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID;
  const model = getDocumentRecognitionModelOption(modelId);
  const modelDirectory = defaultDocumentModelDirectory(modelId);
  const files = await fetchModelManifest(model, options.signal);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_MODEL_BYTES) {
    throw new Error("模型文件体积超过安全限制。");
  }

  await mkdir(modelDirectory, { recursive: true });
  let downloadedFiles = 0;
  let skippedFiles = 0;
  for (const file of files) {
    const destination = resolve(modelDirectory, file.path);
    if (!isInside(modelDirectory, destination)) {
      throw new Error("模型清单包含无效文件路径。");
    }
    await mkdir(dirname(destination), { recursive: true });
    if (await hasExpectedSize(destination, file.size)) {
      skippedFiles += 1;
      continue;
    }
    await downloadModelFile(model, file, destination, options.signal);
    downloadedFiles += 1;
  }

  return {
    modelId,
    modelLabel: model.label,
    runtimeLabel: model.runtimeLabel,
    sourceUrl: model.sourceUrl,
    supportsCurrentPaddleSidecar: model.supportsCurrentPaddleSidecar,
    modelDirectory,
    fileCount: files.length,
    downloadedFiles,
    skippedFiles,
    totalBytes
  };
}

async function fetchModelManifest(model: ReturnType<typeof getDocumentRecognitionModelOption>, signal?: AbortSignal): Promise<ModelFile[]> {
  const manifestUrl = `https://huggingface.co/api/models/${model.repository}/tree/main?recursive=true&expand=false`;
  const response = await fetch(manifestUrl, {
    cache: "no-store",
    signal: withTimeout(signal, 30_000)
  });
  if (!response.ok) throw new Error("无法读取模型清单。");
  const payload = await response.json().catch(() => undefined) as unknown;
  if (!Array.isArray(payload)) throw new Error("模型清单格式无效。");
  const files = payload.flatMap((entry): ModelFile[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const size = typeof record.size === "number" ? record.size : Number(record.size);
    if (record.type !== "file" || !path || !Number.isSafeInteger(size) || size < 0 || isMetadataFile(path)) return [];
    if (!matchesModelFile(model.fileSet, path)) return [];
    return [{ path, size }];
  });

  const requiresConfig = model.fileSet === "paddle" || model.fileSet === "openvino_int4";
  if (requiresConfig && !files.some((file) => file.path === "config.json")) {
    throw new Error("模型清单中没有 config.json。");
  }
  if (!requiresConfig && !files.some((file) => file.path.toLowerCase().endsWith(".gguf"))) {
    throw new Error("GGUF 模型清单中没有可下载的权重文件。");
  }
  return files;
}

async function downloadModelFile(
  model: ReturnType<typeof getDocumentRecognitionModelOption>,
  file: ModelFile,
  destination: string,
  signal?: AbortSignal
) {
  const downloadRoot = `https://huggingface.co/${model.repository}/resolve/main`;
  const url = `${downloadRoot}/${file.path.split("/").map(encodeURIComponent).join("/")}?download=true`;
  const response = await fetch(url, {
    redirect: "follow",
    signal: withTimeout(signal, 30 * 60 * 1000)
  });
  if (!response.ok || !response.body) throw new Error("模型文件下载失败。");
  const partial = `${destination}.careeradapt-partial`;
  const pipelineSignal = withTimeout(signal, 30 * 60 * 1000);
  await pipeline(
    Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(partial, { flags: "w" }),
    { signal: pipelineSignal }
  );
  const partialSize = await stat(partial).then((result) => result.size).catch(() => -1);
  if (partialSize !== file.size) throw new Error("模型文件大小校验失败。");
  await unlink(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rename(partial, destination);
}

async function hasExpectedSize(filePath: string, expectedSize: number) {
  return stat(filePath).then((result) => result.isFile() && result.size === expectedSize).catch(() => false);
}

function matchesModelFile(fileSet: ReturnType<typeof getDocumentRecognitionModelOption>["fileSet"], path: string) {
  const lowerPath = path.toLowerCase();
  if (fileSet === "paddle" || fileSet === "openvino_int4") return true;
  if (fileSet === "official_gguf") return lowerPath.endsWith(".gguf") || lowerPath === "chat_template.jinja";
  return lowerPath.endsWith(`.${fileSet.replace("gguf_", "")}.gguf`);
}

function isMetadataFile(path: string) {
  const name = path.split("/").pop() ?? path;
  return name === ".gitattributes" || name.toLowerCase().startsWith("readme") || name.startsWith("._");
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isInside(root: string, candidate: string) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

export async function hasDownloadedPaddleOcrModel(directory = defaultPaddleOcrModelDirectory()) {
  try {
    await access(join(resolve(directory), "config.json"));
    return true;
  } catch {
    return false;
  }
}
