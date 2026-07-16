import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DocumentEngineHealth,
  DocumentEngineHealthReport
} from "@/domain/schemas";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 1_500;

export async function inspectDocumentEngineHealth(input: {
  modelDirectory?: string;
  checkOpenDataLoader?: boolean;
}): Promise<DocumentEngineHealthReport> {
  const candidates = buildDefaultModelDirectoryCandidates({
    homeDirectory: homedir(),
    environment: process.env
  });
  const existingCandidates = await filterExistingModelDirectories(candidates);
  const requestedDirectory = input.modelDirectory?.trim();
  const modelDirectory = requestedDirectory || existingCandidates[0] || "";

  const [python, model, paddleOcr] = await Promise.all([
    inspectPythonRuntime(),
    inspectModelDirectory(modelDirectory),
    inspectSidecar("PADDLEOCR_VL_ENDPOINT", "paddleocr-vl-local", "本地 OCR sidecar 未配置。")
  ]);

  if (!input.checkOpenDataLoader) {
    return {
      paddleOcr,
      modelDirectory: model,
      python,
      suggestedModelDirectories: existingCandidates
    };
  }

  const [java, openDataLoader] = await Promise.all([
    inspectCommand("java", ["-version"], "java", "未检测到 Java 运行时。"),
    inspectSidecar("OPENDATALOADER_ENDPOINT", "opendataloader", "OpenDataLoader 实验 sidecar 未配置。")
  ]);
  return {
    paddleOcr,
    modelDirectory: model,
    python,
    java,
    openDataLoader,
    suggestedModelDirectories: existingCandidates
  };
}

export function buildDefaultModelDirectoryCandidates(input: {
  homeDirectory: string;
  environment: Record<string, string | undefined>;
}) {
  const home = resolve(input.homeDirectory);
  return unique([
    input.environment.PADDLEOCR_VL_MODEL_DIR?.trim(),
    join(home, ".paddlex", "official_models", "PaddleOCR-VL-1.6"),
    join(home, ".cache", "paddleocr", "PaddleOCR-VL-1.6"),
    join(home, "models", "PaddleOCR-VL-1.6"),
    ...pathEntries(input.environment.PADDLEOCR_VL_MODEL_SEARCH_PATH)
  ].filter((value): value is string => Boolean(value)));
}

async function filterExistingModelDirectories(candidates: string[]) {
  const checks = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    exists: await hasModelConfig(candidate)
  })));
  return checks.filter((item) => item.exists).map((item) => item.candidate);
}

async function inspectModelDirectory(directory: string): Promise<DocumentEngineHealth> {
  if (!directory) {
    return {
      engine: "paddleocr-vl-model",
      status: "missing",
      message: "未检测到模型目录；可填写仓库外的 PaddleOCR-VL-1.6 目录。"
    };
  }
  if (await hasModelConfig(directory)) {
    return {
      engine: "paddleocr-vl-model",
      status: "ready",
      version: "1.6",
      message: "模型目录包含 config.json。"
    };
  }
  return {
    engine: "paddleocr-vl-model",
    status: "error",
    message: "目录不存在或缺少 config.json。"
  };
}

async function inspectPythonRuntime(): Promise<DocumentEngineHealth> {
  const commands: Array<[string, string[]]> = process.platform === "win32"
    ? [["py", ["-3", "--version"]], ["python", ["--version"]]]
    : [["python3", ["--version"]], ["python", ["--version"]]];
  for (const [command, args] of commands) {
    const result = await runCommand(command, args);
    if (result) {
      return {
        engine: "python",
        status: "ready",
        version: result.replace(/^Python\s+/i, "").trim(),
        message: `已检测到 ${command}。`
      };
    }
  }
  return {
    engine: "python",
    status: "missing",
    message: "未检测到 Python 3 环境。"
  };
}

async function inspectCommand(
  command: string,
  args: string[],
  engine: string,
  missingMessage: string
): Promise<DocumentEngineHealth> {
  const output = await runCommand(command, args);
  return output
    ? { engine, status: "ready", version: firstVersion(output), message: `${engine} 依赖可用。` }
    : { engine, status: "missing", message: missingMessage };
}

async function inspectSidecar(
  environmentKey: "PADDLEOCR_VL_ENDPOINT" | "OPENDATALOADER_ENDPOINT",
  engine: string,
  missingMessage: string
): Promise<DocumentEngineHealth> {
  const endpoint = localEndpoint(process.env[environmentKey]);
  if (!endpoint) return { engine, status: "missing", message: missingMessage };
  try {
    const response = await fetch(`${endpoint}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500)
    });
    const payload = await response.json().catch(() => undefined);
    const ready = response.ok && payload && typeof payload === "object"
      && ("ok" in payload ? payload.ok === true : true);
    return {
      engine,
      status: ready ? "ready" : "error",
      version: readString(payload, "version") ?? readString(payload, "engineVersion"),
      message: readString(payload, "message") ?? (ready ? "本地 sidecar 已响应。" : "本地 sidecar 健康检查失败。")
    };
  } catch {
    return { engine, status: "error", message: "本地 sidecar 未响应。" };
  }
}

async function hasModelConfig(directory: string) {
  try {
    await access(join(resolve(directory), "config.json"));
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
      env: process.env
    });
    return `${result.stdout}\n${result.stderr}`.trim();
  } catch {
    return undefined;
  }
}

function localEndpoint(value: string | undefined) {
  const normalized = value?.trim().replace(/\/$/, "");
  return normalized && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(normalized)
    ? normalized
    : undefined;
}

function pathEntries(value: string | undefined) {
  return value?.split(delimiter).map((item) => item.trim()).filter(Boolean) ?? [];
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => resolve(value))));
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function firstVersion(value: string) {
  return value.match(/\d+(?:\.\d+){1,3}/)?.[0] ?? value.split(/\r?\n/)[0]?.slice(0, 80);
}
