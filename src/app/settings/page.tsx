"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/services/notifications/store";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type {
  DocumentEngineHealth,
  DocumentEngineHealthReport,
  DocumentRecognitionPreferences
} from "@/domain/schemas";
import { DOCUMENT_RECOGNITION_MODEL_OPTIONS } from "@/domain/documentRecognition/modelCatalog";
import { runResumeOcrAdapter } from "@/domain/resumeImport/ocrAdapter";
import { readDeveloperMode, writeDeveloperMode } from "@/services/preferences/developerMode";
import {
  readDocumentRecognitionPreferences,
  writeDocumentRecognitionPreferences
} from "@/services/preferences/documentRecognition";
import { readAiSettings, writeAiSettings, clearAiSettings, type AiSettings } from "@/services/storage/aiSettings";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { AgentSession } from "@/agent/contracts/agentSession";
import {
  getHermesConfig,
  getHermesConfigSchema,
  getHermesLogs,
  getHermesStatus,
  openHermesLogs,
  requestHermesRecover,
  requestHermesRestart,
  requestHermesStart,
  requestHermesStop,
  subscribeHermesStatus,
  type HermesConfigSchema,
  type HermesConfigSnapshot,
  type HermesControlResult,
  type HermesLogs,
  type HermesSupervisorSnapshot
} from "@/services/agent/hermesControl";
import { FileText, Power, RotateCcw, Trash2, Wrench } from "lucide-react";
import {
  ProductField,
  ProductSelect,
  ProductTopbar
} from "@/components/ui/product";
import { useAgentHost } from "@/components/agent/runtime/AgentRuntimeProvider";
import { createRunStopReason } from "@/agent/runtime/hermes/hermesIncidentTrace";
import {
  getLatestCoreClosureSelfCheck,
  runP45CoreClosureSelfCheck,
  type CoreClosureSelfCheckResult
} from "@/services/diagnostics/p45CoreClosureSelfCheck";
import { buildProfileRecoveryCandidates } from "@/domain/profile/profileContentRecovery";

type ThemePreference = "system" | "light" | "dark";
type DensityPreference = "compact" | "comfortable";
type SettingsCategory = "appearance" | "document" | "export" | "ai" | "hermes" | "data" | "developer" | "help";

type HermesSettingsHealth = {
  available?: boolean;
  version?: string;
  reason?: string;
  provider?: string;
  model?: string;
  providerStatus?: string;
  mcpConnected?: boolean;
  discoveredToolCount?: number;
  runtimeUrl?: string;
  appUrl?: string;
  runtimeHealth?: {
    careerSkillsLoaded?: boolean;
    providerReady?: boolean;
    careerMcpServerReachable?: boolean;
    hermesMcpRegistered?: boolean;
    hermesMcpToolCount?: number;
    hermesCareerFacadeCount?: number;
    requiredCareerFacadesMissing?: string[];
    careerGatewayContracts?: string[];
    careerMcpExposedTools?: string[];
    runReady?: boolean;
  };
};

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";

const categories: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: "appearance", label: "界面", description: "主题与显示密度" },
  { id: "document", label: "文档识别", description: "PDF、DOCX 与本地 OCR" },
  { id: "ai", label: "AI 配置", description: "接口与模型设置" },
  { id: "hermes", label: "Hermes 运行时", description: "AI 服务与 MCP 状态" },
  { id: "export", label: "导出", description: "A4 与 PDF 行为" },
  { id: "data", label: "数据管理", description: "归档任务与回收站" },
  { id: "developer", label: "开发者模式", description: "测试数据清理" },
  { id: "help", label: "帮助", description: "说明入口" }
];

export default function SettingsPage() {
  const agentHost = useAgentHost();
  const ocrTestInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  const [theme, setTheme] = useState<ThemePreference>(() => typeof window === "undefined" ? "system" : readThemePreference());
  const [density, setDensity] = useState<DensityPreference>(() => typeof window === "undefined" ? "compact" : readDensityPreference());
  const [developerMode, setDeveloperMode] = useState(() => typeof window !== "undefined" && readDeveloperMode());
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => typeof window === "undefined" ? { baseUrl: "", apiKey: "", model: "", provider: "openai-compatible" } : readAiSettings());
  const [aiSaved, setAiSaved] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [hermesHealth, setHermesHealth] = useState<HermesSettingsHealth>();
  const [hermesStatus, setHermesStatus] = useState<HermesSupervisorSnapshot>();
  const [hermesConfig, setHermesConfig] = useState<HermesConfigSnapshot>();
  const [hermesConfigSchema, setHermesConfigSchema] = useState<HermesConfigSchema>();
  const [hermesLogs, setHermesLogs] = useState<HermesLogs>();
  const [hermesChecking, setHermesChecking] = useState(false);
  const [hermesStarting, setHermesStarting] = useState(false);
  const [hermesFeedback, setHermesFeedback] = useState("应用启动时会自动启动 Hermes；异常退出后可在此恢复。");
  const [documentPreferences, setDocumentPreferences] = useState<DocumentRecognitionPreferences>(() =>
    typeof window === "undefined" ? readDocumentRecognitionPreferences() : readDocumentRecognitionPreferences()
  );
  const [engineHealth, setEngineHealth] = useState<DocumentEngineHealthReport>();
  const [healthChecking, setHealthChecking] = useState(false);
  const [modelDownloading, setModelDownloading] = useState(false);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [documentFeedback, setDocumentFeedback] = useState("设置会保存在本机浏览器，不保存简历正文、OCR 输出或模型日志。");
  const repositoryRef = useRef(new WorkspaceRepository());
  const [orphanedCounts, setOrphanedCounts] = useState<{ drafts: number; rawInputs: number; pdfSessions: number; orphanedDraftIds: string[]; orphanedRawInputIds: string[]; orphanedPdfSessionIds: string[] } | null>(null);
  const [orphanedLoading, setOrphanedLoading] = useState(false);
  const [orphanedClearing, setOrphanedClearing] = useState(false);
  const [coreSelfCheck, setCoreSelfCheck] = useState<CoreClosureSelfCheckResult | undefined>(() => getLatestCoreClosureSelfCheck());
  const [coreSelfChecking, setCoreSelfChecking] = useState(false);
  const [coreRepairing, setCoreRepairing] = useState(false);
  const [selectedRepairCandidateId, setSelectedRepairCandidateId] = useState<string>();
  const [archivedSessions, setArchivedSessions] = useState<AgentSession[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const sessionStoreRef = useRef(new AgentSessionStore());

  function updateTheme(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
    applyPreferences(nextTheme, density);
  }

  function updateDensity(nextDensity: DensityPreference) {
    setDensity(nextDensity);
    window.localStorage.setItem(densityStorageKey, nextDensity);
    applyPreferences(theme, nextDensity);
  }

  function updateDocumentPreferences(patch: Partial<DocumentRecognitionPreferences>) {
    setDocumentPreferences((current) => {
      const next = { ...current, ...patch };
      writeDocumentRecognitionPreferences(next);
      return next;
    });
    setDocumentFeedback("文档识别设置已保存。");
  }

  const scanOrphanedData = useCallback(async () => {
    setOrphanedLoading(true);
    try {
      const result = await repositoryRef.current.getOrphanedDataCounts();
      setOrphanedCounts(result);
    } catch {
      notify({ type: "error", title: "扫描失败", message: "无法读取数据库，请刷新后重试。" });
    } finally {
      setOrphanedLoading(false);
    }
  }, []);

  async function clearOrphanedData() {
    if (!orphanedCounts) return;
    setOrphanedClearing(true);
    try {
      await repositoryRef.current.clearOrphanedData(orphanedCounts.orphanedDraftIds, orphanedCounts.orphanedRawInputIds, orphanedCounts.orphanedPdfSessionIds);
      const total = orphanedCounts.drafts + orphanedCounts.rawInputs + orphanedCounts.pdfSessions;
      notify({ type: "success", title: "清理完成", message: `已清除 ${total} 条孤儿数据。` });
      setOrphanedCounts(null);
    } catch {
      notify({ type: "error", title: "清理失败", message: "请刷新后重试。" });
    } finally {
      setOrphanedClearing(false);
    }
  }

  useEffect(() => {
    if (category !== "developer" || orphanedCounts || orphanedLoading) return;
    const timer = window.setTimeout(() => { void scanOrphanedData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [category, orphanedCounts, orphanedLoading, scanOrphanedData]);

  async function checkDocumentEngines() {
    setHealthChecking(true);
    setDocumentFeedback("正在执行轻量检查，不会加载大型模型…");
    try {
      const response = await fetch("/api/document-engines/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelDirectory: documentPreferences.modelDirectory || undefined,
          checkOpenDataLoader: documentPreferences.openDataLoaderExperimental
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "检查失败");
      setEngineHealth(payload as DocumentEngineHealthReport);
      if (!documentPreferences.modelDirectory && payload.suggestedModelDirectories?.[0]) {
        updateDocumentPreferences({ modelDirectory: payload.suggestedModelDirectories[0] });
      }
      setDocumentFeedback("检查完成。模型只在实际识别时加载。");
    } catch (error) {
      setDocumentFeedback(error instanceof Error ? error.message : "文档引擎检查失败。");
    } finally {
      setHealthChecking(false);
    }
  }

  async function testLocalOcr(file: File | undefined) {
    if (!file) return;
    setDocumentFeedback("正在测试本地识别；首次运行可能较慢…");
    const result = await runResumeOcrAdapter(file);
    setDocumentFeedback(result.ok
      ? `测试完成：识别 ${result.pageCount} 页。结果仅用于本次测试，未保存。`
      : `${result.message} 未保存 OCR 输出。`);
  }

  async function downloadLocalOcrModel() {
    if (modelDownloading) return;
    const selectedModel = DOCUMENT_RECOGNITION_MODEL_OPTIONS.find((option) => option.id === documentPreferences.modelId) ?? DOCUMENT_RECOGNITION_MODEL_OPTIONS[0];
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setModelDownloading(true);
    setDocumentFeedback(`正在从 ${selectedModel.sourceLabel} 下载 ${selectedModel.label}（${selectedModel.sizeLabel}）；可以随时取消…`);
    try {
      const response = await fetch("/api/document-engines/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: selectedModel.id }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => undefined) as {
        ok?: boolean;
        modelDirectory?: string;
        message?: string;
      } | undefined;
      if (!response.ok || !payload?.ok || !payload.modelDirectory) {
        throw new Error(payload?.message || "模型下载未完成。");
      }
      if (selectedModel.supportsCurrentPaddleSidecar) {
        updateDocumentPreferences({ modelDirectory: payload.modelDirectory });
        setEngineHealth(undefined);
        setDocumentFeedback(`${payload.message || "模型已准备好。"} 接下来请检测本地 PaddleOCR 环境。`);
      } else {
        setDocumentFeedback(`${payload.message || "模型已准备好。"} 当前下载目录已隔离保存；使用前请配置 ${selectedModel.runtimeLabel}，它不会替换当前 PaddleOCR sidecar。`);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setDocumentFeedback("模型下载已取消；已完成文件会保留，未完成文件将在下次重试时覆盖。");
      } else {
        setDocumentFeedback(error instanceof Error ? error.message : "模型下载未完成，请稍后重试。");
      }
    } finally {
      if (downloadAbortRef.current === controller) downloadAbortRef.current = null;
      setModelDownloading(false);
    }
  }

  async function runCoreClosureSelfCheck() {
    if (coreSelfChecking) return;
    setCoreSelfChecking(true);
    try {
      const result = await runP45CoreClosureSelfCheck({
        repository: repositoryRef.current,
        runtimeSnapshot: agentHost.runtimeStatus.getSnapshot(),
        contracts: agentHost.careerToolGateway.listContracts(),
        activeSession: agentHost.state.getSnapshot().activeSession,
        fetcher: window.fetch.bind(window)
      });
      setCoreSelfCheck(result);
      notify({
        type: result.overallStatus === "PASS" ? "success" : result.overallStatus === "FAIL" ? "warning" : "info",
        title: result.overallStatus === "PASS" ? "核心闭环自检通过" : "核心闭环自检已完成",
        message: result.overallStatus === "PASS"
          ? "运行时、资料完整性与 Repository 读回均已通过。"
          : "请查看各项状态；诊断只展示安全计数与标识，不导出正文。"
      });
    } catch {
      notify({ type: "error", title: "核心闭环自检失败", message: "诊断未完成，请刷新应用后重试。" });
    } finally {
      setCoreSelfChecking(false);
    }
  }

  async function repairProfileContent() {
    if (coreRepairing || !coreSelfCheck?.repairRequired || !coreSelfCheck.profileId || coreSelfCheck.profileRevision === undefined) return;
    const repository = repositoryRef.current;
    const profile = await repository.getProfile(coreSelfCheck.profileId);
    if (!profile || profile.version !== coreSelfCheck.profileRevision) {
      notify({ type: "warning", title: "资料版本已变化", message: "请重新运行核心闭环自检后再修复。" });
      return;
    }
    const branches = await repository.listResumeBranches(profile.id);
    const generalResume = branches
      .filter((branch) => branch.branchPurpose === "general" && branch.lifecycleStatus === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const importedDraft = await repository.getLatestImportedResumeDraft();
    const candidates = buildProfileRecoveryCandidates({ profile, importedDraft, generalResume });
    const candidate = candidates.find((item) => item.id === selectedRepairCandidateId)
      ?? candidates.find((item) => item.affectedEntityCount > 0);
    if (!candidate || candidate.affectedEntityCount === 0) {
      notify({ type: "info", title: "没有可修复内容", message: "当前没有新的、已确认且可安全回填的资料来源。" });
      return;
    }
    if (!window.confirm(`将使用「${candidate.sourceLabel}」创建新的 Profile 版本，影响 ${candidate.affectedEntityCount} 个条目。继续吗？`)) return;
    setCoreRepairing(true);
    try {
      const repaired = await repository.repairProfileContent({
        profileId: profile.id,
        expectedProfileVersion: profile.version,
        operationId: `profile-content-repair-${crypto.randomUUID()}`,
        sourceType: candidate.sourceType,
        items: candidate.items
      });
      const verified = await runP45CoreClosureSelfCheck({
        repository,
        runtimeSnapshot: agentHost.runtimeStatus.getSnapshot(),
        contracts: agentHost.careerToolGateway.listContracts(),
        activeSession: agentHost.state.getSnapshot().activeSession,
        fetcher: window.fetch.bind(window)
      });
      setCoreSelfCheck(verified);
      if (!repaired.readbackVerified || verified.checks.repositoryReadback.status !== "PASS" || verified.checks.profileContentIntegrity.status !== "PASS") {
        throw new Error("profile_content_repair_verification_failed");
      }
      notify({ type: "success", title: "资料内容已修复", message: `已创建新的 Profile 版本并完成读回校验（${repaired.profileId}）。` });
    } catch {
      notify({ type: "error", title: "资料修复未完成", message: "写入或读回校验未通过，未报告为同步成功。请重新运行诊断。" });
    } finally {
      setCoreRepairing(false);
    }
  }

  function exportCoreClosureSelfCheck() {
    if (!coreSelfCheck) return;
    const blob = new Blob([JSON.stringify(coreSelfCheck, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `careeradapt-core-self-check-${coreSelfCheck.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify({ type: "success", title: "诊断已导出", message: "仅包含安全计数、运行标识、阶段与读回结果，未包含正文。" });
  }

  function cancelLocalOcrModelDownload() {
    if (!downloadAbortRef.current) return;
    setDocumentFeedback("正在取消模型下载…");
    downloadAbortRef.current.abort();
  }

  const checkHermesHealth = useCallback(async () => {
    setHermesChecking(true);
    try {
      const response = await fetch("/api/agent/runtime/hermes/health", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as HermesSettingsHealth;
      setHermesHealth(payload);
      setHermesFeedback(response.ok && payload.available === true
        ? "Hermes API Server 已响应。"
        : "Hermes 当前未就绪，可以点击启动或重试。" );
    } catch {
      setHermesFeedback("无法读取 Hermes 状态，请确认应用服务仍在运行。");
    } finally {
      setHermesChecking(false);
    }
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("category");
    const timer = window.setTimeout(() => {
      if (categories.some((item) => item.id === requested)) setCategory(requested as SettingsCategory);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeHermesStatus((snapshot) => {
      if (active) setHermesStatus(snapshot);
    });
    void Promise.all([getHermesStatus(), getHermesConfig(), getHermesConfigSchema()]).then(([status, config, schema]) => {
      if (!active) return;
      if (status) setHermesStatus(status);
      if (config) setHermesConfig(config);
      if (schema) setHermesConfigSchema(schema);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function startHermesFromSettings() {
    if (hermesStarting) return;
    setHermesStarting(true);
    setHermesFeedback("正在启动 Hermes API Server…");
    try {
      const result = await requestHermesStart();
      if (result.snapshot) setHermesStatus(result.snapshot);
      if (!result.ok) throw new Error(result.reason ?? "Hermes 启动失败。");
      setHermesFeedback(result.snapshot ? hermesFeedbackForState(result.snapshot) : "Hermes 已接受启动请求，正在同步 Career 工具。");
      await checkHermesHealth();
    } catch (error) {
      setHermesFeedback(error instanceof Error ? error.message : "Hermes 启动失败，请查看运行日志。");
    } finally {
      setHermesStarting(false);
    }
  }

  async function runHermesControl(action: () => Promise<HermesControlResult | undefined>, successMessage: string) {
    if (hermesStarting) return;
    setHermesStarting(true);
    try {
      const result = await action();
      if (result?.snapshot) setHermesStatus(result.snapshot);
      if (result && !result.ok) throw new Error(result.reason ?? "Hermes 控制操作未完成。");
      setHermesFeedback(result?.snapshot ? hermesFeedbackForState(result.snapshot) : successMessage);
    } catch (error) {
      setHermesFeedback(error instanceof Error ? error.message : "Hermes 控制操作未完成，请查看日志。");
    } finally {
      setHermesStarting(false);
    }
  }

  async function stopHermesFromSettings() {
    const session = agentHost.state.getSnapshot().activeSession;
    const activeRun = Boolean(
      session
      && (session.activeTurn?.status === "running"
        || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? ""))
    );
    if (activeRun && session) {
      await agentHost.interruptRun(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "user_stop",
        sourceComponent: "SettingsPage.stopHermes",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
    }
    await runHermesControl(requestHermesStop, "Hermes 已停止。");
  }

  async function restartHermesFromSettings() {
    const session = agentHost.state.getSnapshot().activeSession;
    const activeRun = Boolean(
      hermesStatus?.activeRunId
      || (session
        && (session.activeTurn?.status === "running"
          || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")))
    );
    if (activeRun && !window.confirm("当前 AI 任务正在执行。重启 Hermes 会中断当前运行，但会保留任务进度；确定继续吗？")) return;
    if (activeRun && session) {
      await agentHost.interruptRun(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "runtime_restart",
        sourceComponent: "SettingsPage.restartHermes",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
    }
    await runHermesControl(() => requestHermesRestart({ reason: "user_explicit_restart" }), "Hermes 已提交重启。");
  }

  async function refreshHermesLogs() {
    const result = await getHermesLogs();
    if (result) setHermesLogs(result);
  }

  async function openHermesLogFile() {
    await refreshHermesLogs();
    const result = await openHermesLogs();
    if (result && !result.ok) setHermesFeedback(result.reason ?? "无法打开 Hermes 日志。");
  }

  async function saveAiConfiguration() {
    if (aiSaving) return;
    setAiSaving(true);
    writeAiSettings(aiSettings);
    setAiSaved(true);
    try {
      const result = await requestHermesStart();
      setHermesFeedback(result.ok
        ? "AI 配置已保存，Hermes 已按新配置重载。"
        : `AI 配置已保存，但 Hermes 尚未就绪：${result.reason ?? "请稍后重试。"}`);
    } catch (error) {
      setHermesFeedback(error instanceof Error
        ? `AI 配置已保存，但 Hermes 重载失败：${error.message}`
        : "AI 配置已保存，但 Hermes 重载失败，请稍后重试。");
    } finally {
      setAiSaving(false);
      window.setTimeout(() => setAiSaved(false), 2000);
    }
  }

  useEffect(() => {
    if (category !== "hermes") return;
    const timer = window.setTimeout(() => { void checkHermesHealth(); }, 0);
    return () => window.clearTimeout(timer);
  }, [category, checkHermesHealth]);

  return (
    <main className="page-shell settings-workspace">
      <ProductTopbar title="设置" status="偏好仅保存在本机" />

      <section className="settings-layout product-settings-layout">
        <aside className="panel settings-nav">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "profile-category-button profile-category-button-active" : "profile-category-button"}
              onClick={() => setCategory(item.id)}
            >
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </aside>

        <section className="panel settings-panel">
          {category === "appearance" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>界面偏好</h2>
                  <p>偏好保存在本机浏览器，不创建简历版本，也不修改简历正文。</p>
                </div>
              </div>
              <ProductField label="主题">
                <ProductSelect aria-label="主题" value={theme} onChange={(event) => updateTheme(event.target.value as ThemePreference)}>
                  <option value="system">跟随系统</option>
                  <option value="light">明亮</option>
                  <option value="dark">暗黑</option>
                </ProductSelect>
              </ProductField>
              <ProductField label="显示密度">
                <ProductSelect aria-label="显示密度" value={density} onChange={(event) => updateDensity(event.target.value as DensityPreference)}>
                  <option value="compact">紧凑</option>
                  <option value="comfortable">舒适</option>
                </ProductSelect>
              </ProductField>
            </div>
          ) : null}

          {category === "document" ? (
            <div className="settings-section document-recognition-settings">
              <div className="section-heading compact-heading">
                <div>
                  <h2>文档识别</h2>
                  <p>控制 PDF、DOCX 与扫描件导入路线。所有识别结果仍需进入导入核对。</p>
                </div>
                <span className="settings-save-state" role="status" aria-live="polite">{documentFeedback}</span>
              </div>

              <section className="settings-group" aria-labelledby="document-parsing-mode">
                <div className="settings-group-heading">
                  <div>
                    <h3 id="document-parsing-mode">解析模式</h3>
                    <p>自动模式优先保留数字文本层，只有扫描件或损坏文本层才使用本地 OCR。</p>
                  </div>
                </div>
                <label className="field-label">
                  默认路线
                  <select
                    name="document-parsing-mode"
                    value={documentPreferences.parsingMode}
                    onChange={(event) => updateDocumentPreferences({
                      parsingMode: event.target.value as DocumentRecognitionPreferences["parsingMode"]
                    })}
                  >
                    <option value="auto">自动选择（推荐）</option>
                    <option value="text_layer">优先使用文本层</option>
                    <option value="local_ocr">强制本地 OCR</option>
                    <option value="manual_review">仅手动核对</option>
                  </select>
                </label>
                <label className="settings-toggle-row">
                  <span><strong>允许导入时手动选择路线</strong><small>显示“继续文本解析、改用本地 OCR、仅人工核对”。</small></span>
                  <input
                    type="checkbox"
                    checked={documentPreferences.allowManualRouteSelection}
                    onChange={(event) => updateDocumentPreferences({ allowManualRouteSelection: event.target.checked })}
                  />
                </label>
              </section>

              <section className="settings-group" aria-labelledby="local-ocr-heading">
                <div className="settings-group-heading">
                  <div>
                    <h3 id="local-ocr-heading">本地 OCR</h3>
                    <p>PaddleOCR-VL-1.6 在本机 sidecar 中运行，不是百度千帆在线模型。</p>
                  </div>
                  <HealthBadge health={healthChecking ? loadingHealth("paddleocr-vl-local") : engineHealth?.paddleOcr} />
                </div>
                <label className="settings-toggle-row">
                  <span><strong>允许使用本地 OCR</strong><small>OCR 预计较慢；失败后回退到文本解析或人工核对。</small></span>
                  <input
                    type="checkbox"
                    checked={documentPreferences.localOcrEnabled}
                    onChange={(event) => updateDocumentPreferences({ localOcrEnabled: event.target.checked })}
                  />
                </label>
                <label className="field-label">
                  模型下载来源
                  <select
                    name="document-recognition-model"
                    value={documentPreferences.modelId}
                    disabled={modelDownloading}
                    onChange={(event) => updateDocumentPreferences({ modelId: event.target.value as DocumentRecognitionPreferences["modelId"] })}
                  >
                    {DOCUMENT_RECOGNITION_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label} · {option.sizeLabel}</option>
                    ))}
                  </select>
                  <small className="field-help">{DOCUMENT_RECOGNITION_MODEL_OPTIONS.find((option) => option.id === documentPreferences.modelId)?.description}</small>
                  {(() => {
                    const selectedModel = DOCUMENT_RECOGNITION_MODEL_OPTIONS.find((option) => option.id === documentPreferences.modelId) ?? DOCUMENT_RECOGNITION_MODEL_OPTIONS[0];
                    return <a className="settings-inline-link" href={selectedModel.sourceUrl} target="_blank" rel="noreferrer">查看模型仓库：{selectedModel.repository}</a>;
                  })()}
                </label>
                <dl className="document-engine-facts">
                  <div><dt>引擎</dt><dd>PaddleOCR-VL-1.6</dd></div>
                  <div><dt>Python 环境</dt><dd><HealthText health={engineHealth?.python} /></dd></div>
                  <div><dt>检测模型</dt><dd><HealthText health={engineHealth?.modelDirectory} /></dd></div>
                </dl>
                <label className="field-label">
                  模型目录
                  <input
                    name="paddleocr-model-directory"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={documentPreferences.modelDirectory}
                    onChange={(event) => updateDocumentPreferences({ modelDirectory: event.target.value })}
                    placeholder="填写仓库外的 PaddleOCR-VL-1.6 目录…"
                  />
                </label>
                {engineHealth?.suggestedModelDirectories.length ? (
                  <label className="field-label">
                    已检测目录
                    <select
                      name="detected-model-directory"
                      value={documentPreferences.modelDirectory}
                      onChange={(event) => updateDocumentPreferences({ modelDirectory: event.target.value })}
                    >
                      {engineHealth.suggestedModelDirectories.map((directory) => (
                        <option key={directory} value={directory}>{directory}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="action-row">
                  <button className="button button-primary" type="button" disabled={healthChecking} onClick={() => { void checkDocumentEngines(); }}>
                    {healthChecking ? "检测中…" : "检测模型"}
                  </button>
                  {modelDownloading ? (
                    <button className="button button-secondary" type="button" onClick={cancelLocalOcrModelDownload}>
                      取消下载
                    </button>
                  ) : (
                    <button className="button button-secondary" type="button" onClick={() => { void downloadLocalOcrModel(); }}>
                      下载 OCR 模型
                    </button>
                  )}
                  <button className="button button-secondary" type="button" onClick={() => ocrTestInputRef.current?.click()}>
                    测试识别
                  </button>
                </div>
                <input
                  ref={ocrTestInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  aria-label="选择本地 OCR 测试文件"
                  onChange={(event) => {
                    void testLocalOcr(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                <details className="settings-help-details">
                  <summary>打开配置说明</summary>
                  <p>“下载 OCR 模型”会把选中的 Hugging Face 权重保存到本机用户数据目录，不会写入项目或安装目录。官方 BF16 模型可接入当前 PaddleOCR/PaddlePaddle localhost sidecar；OpenVINO INT4、Transformers INT8 和 GGUF 是独立运行时路线，其中 GGUF 使用 llama.cpp，可在 CPU 运行并按需 GPU offload。Python、PaddlePaddle、OpenVINO、llama.cpp 及 GPU/CUDA 驱动不能由应用安全地替用户自动安装，缺失时应先使用匹配设备的官方运行时安装方式。不要提交模型、真实路径或 token。</p>
                </details>
              </section>

              <section className="settings-group" aria-labelledby="digital-pdf-heading">
                <div className="settings-group-heading">
                  <div><h3 id="digital-pdf-heading">数字 PDF</h3><p>PDF.js 坐标阅读顺序已正式启用。</p></div>
                  <span className="status-badge status-badge-ready">正式启用</span>
                </div>
                <dl className="document-engine-facts">
                  <div><dt>当前路由原因</dt><dd>文本层可用时优先保留坐标、阅读顺序和逐字来源。</dd></div>
                  <div><dt>文本层质量</dt><dd>导入后显示覆盖率、乱码、碎片化与阅读顺序判断。</dd></div>
                </dl>
              </section>

              <section className="settings-group" aria-labelledby="opendataloader-heading">
                <div className="settings-group-heading">
                  <div><h3 id="opendataloader-heading">OpenDataLoader</h3><p>实验功能，默认关闭；失败自动回退 PDF.js。</p></div>
                  <span className="status-badge">实验</span>
                </div>
                <label className="settings-toggle-row">
                  <span><strong>启用实验解析</strong><small>仅复杂数字 PDF 可能尝试使用，不替代正式默认解析器。</small></span>
                  <input
                    type="checkbox"
                    checked={documentPreferences.openDataLoaderExperimental}
                    onChange={(event) => updateDocumentPreferences({ openDataLoaderExperimental: event.target.checked })}
                  />
                </label>
                {documentPreferences.openDataLoaderExperimental ? (
                  <dl className="document-engine-facts">
                    <div><dt>服务状态</dt><dd><HealthText health={engineHealth?.openDataLoader} /></dd></div>
                    <div><dt>Java 依赖</dt><dd><HealthText health={engineHealth?.java} /></dd></div>
                    <div><dt>Python 依赖</dt><dd><HealthText health={engineHealth?.python} /></dd></div>
                  </dl>
                ) : null}
              </section>

              <section className="settings-group" aria-labelledby="online-recognition-heading">
                <div className="settings-group-heading">
                  <div><h3 id="online-recognition-heading">在线识别</h3><p>仅预留 Adapter 与设置状态，本轮不接入真实在线 API。</p></div>
                </div>
                <dl className="document-engine-facts">
                  <div><dt>百度千帆</dt><dd>尚未配置</dd></div>
                  <div><dt>密钥</dt><dd>未提供输入，也不会保存明文 API key。</dd></div>
                </dl>
              </section>
            </div>
          ) : null}

          {category === "ai" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>AI 配置</h2>
                  <p>配置 AI 模型接口。保存后会立即重载内置 Hermes；正常语义 Agent 始终由 Hermes 负责，配置或运行异常会明确显示在运行状态中。</p>
                </div>
              </div>
              <label className="field-label">
                提供商
                <select
                  value={aiSettings.provider}
                  onChange={(event) => setAiSettings((prev) => ({ ...prev, provider: event.target.value }))}
                >
                  <option value="openai-compatible">OpenAI 兼容接口</option>
                  <option value="mock">Mock 模式（无需密钥）</option>
                </select>
              </label>
              {aiSettings.provider !== "mock" ? (
                <>
                  <label className="field-label">
                    API 地址
                    <input
                      type="text"
                      value={aiSettings.baseUrl}
                      onChange={(event) => setAiSettings((prev) => ({ ...prev, baseUrl: event.target.value }))}
                      placeholder="留空使用应用内置 Hermes 接口"
                    />
                  </label>
                  <label className="field-label">
                    API 密钥
                    <div style={{ position: "relative" }}>
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={aiSettings.apiKey}
                        onChange={(event) => setAiSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="输入本机 API 密钥"
                        style={{ paddingRight: "2.5rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((prev) => !prev)}
                        style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", color: "var(--color-text-secondary, #666)" }}
                      >
                        {showApiKey ? "隐藏" : "显示"}
                      </button>
                    </div>
                  </label>
                  <label className="field-label">
                    模型名称
                    <input
                      type="text"
                      value={aiSettings.model}
                      onChange={(event) => setAiSettings((prev) => ({ ...prev, model: event.target.value }))}
                      placeholder="留空使用应用内置 Hermes 模型"
                    />
                  </label>
                </>
              ) : null}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={aiSaving}
                  onClick={() => void saveAiConfiguration()}
                >
                  {aiSaving ? "正在重载 Hermes…" : aiSaved ? "已保存 ✓" : "保存配置"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={aiTesting || aiSettings.provider === "mock"}
                  onClick={async () => {
                    setAiTesting(true);
                    try {
                      const headers: Record<string, string> = { "Content-Type": "application/json" };
                      const hasCustom = aiSettings.apiKey.length > 0 || aiSettings.baseUrl.length > 0 || aiSettings.model.length > 0;
                      if (hasCustom) {
                        const { encodeAiSettingsForHeader } = await import("@/services/storage/aiSettings");
                        headers["x-ai-config"] = encodeAiSettingsForHeader(aiSettings);
                      }
                      const res = await fetch("/api/ai/test", { method: "POST", headers });
                      const data = await res.json();
                      if (data.ok) {
                        notify({ type: "success", title: "连接成功", message: `已连接 ${data.model}，响应 ${data.latencyMs}ms。` });
                      } else {
                        const descriptions: Record<string, string> = {
                          "missing_ai_config": "缺少 API Key 或模型名称，请填写后再测试。",
                          "provider_protocol_mismatch": "API 地址使用了不兼容的协议，请确认是 OpenAI 兼容接口。",
                          "provider_http_401": "API Key 无效或已过期，请检查后重试。",
                          "provider_http_403": "API Key 无权限访问该模型，请检查模型名称和 Key 是否匹配。",
                          "provider_http_429": "请求过于频繁，请稍后再试。",
                          "provider_http_500": "服务端内部错误，请稍后再试。",
                          "provider_http_502": "网关错误，请检查 API 地址是否正确。",
                          "provider_http_503": "服务暂时不可用，请稍后再试。",
                          "model_output_too_large": "模型返回内容过长，已安全截断，连接正常。"
                        };
                        notify({ type: "error", title: "连接失败", message: descriptions[data.code] ?? data.message ?? "未知错误。" });
                      }
                    } catch {
                      notify({ type: "error", title: "连接失败", message: "网络请求异常，请检查 API 地址和网络连接。" });
                    } finally {
                      setAiTesting(false);
                    }
                  }}
                >
                  {aiTesting ? "测试中…" : "测试连接"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    clearAiSettings();
                    setAiSettings({ baseUrl: "", apiKey: "", model: "", provider: "openai-compatible" });
                    setShowApiKey(false);
                  }}
                >
                  恢复默认
                </button>
              </div>
            </div>
          ) : null}

          {category === "hermes" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>Hermes Control Center</h2>
                  <p>Hermes 是随应用安装的语义 Agent 运行时。状态、启动、恢复和日志均由 Electron 主进程 Supervisor 统一管理。</p>
                </div>
              </div>
              <section className="settings-group hermes-control-section" aria-labelledby="hermes-state-heading">
                <div className="settings-group-heading">
                  <div><h3 id="hermes-state-heading">运行状态</h3><p>“Ready” 只表示进程、API、Provider、Career MCP、工具面和 Run 全部可用。</p></div>
                  <span className={`status-badge hermes-state-badge is-${hermesLifecycleState(hermesStatus, hermesHealth)}`}>{hermesLifecycleLabel(hermesStatus, hermesHealth)}</span>
                </div>
                <dl className="info-list hermes-control-facts">
                  <div><dt>Runtime</dt><dd>{formatEndpoint(hermesStatus?.runtimeUrl ?? hermesHealth?.runtimeUrl, "正在分配")}{hermesStatus?.version || hermesHealth?.version ? ` · ${hermesStatus?.version ?? hermesHealth?.version}` : ""}</dd></div>
                  <div><dt>应用 / MCP</dt><dd>{formatEndpoint(hermesStatus?.appUrl ?? hermesHealth?.appUrl, "当前应用端口")}</dd></div>
                  <div><dt>Provider</dt><dd>{hermesStatus?.provider || hermesHealth?.provider || hermesConfig?.provider || "正在读取"}</dd></div>
                  <div><dt>模型</dt><dd>{hermesStatus?.model || hermesHealth?.model || hermesConfig?.model || "正在读取"}</dd></div>
                  <div><dt>运行时方式</dt><dd>内置 bundled runtime · 主进程托管</dd></div>
                  <div><dt>API Key</dt><dd>{hermesConfig ? (hermesConfig.apiKeyConfigured ? "已配置（仅显示状态）" : "未配置") : "由本机环境托管"}</dd></div>
                </dl>
              </section>

              <section className="settings-group hermes-control-section" aria-labelledby="hermes-readiness-heading">
                <div className="settings-group-heading">
                  <div><h3 id="hermes-readiness-heading">Readiness dimensions</h3><p>同步中、降级和进程不可用是不同状态，不会被混写成“进程失败”。</p></div>
                </div>
                <div className="hermes-dimension-grid">
                  {([
                    ["Process", hermesStatus?.processReady ?? hermesHealth?.available === true],
                    ["API", hermesStatus?.apiReady ?? hermesHealth?.available === true],
                    ["Provider", hermesStatus?.providerReady ?? hermesHealth?.runtimeHealth?.providerReady === true],
                    ["Career MCP", hermesStatus?.careerMcpReady ?? (hermesHealth?.mcpConnected === true && hermesHealth.runtimeHealth?.careerMcpServerReachable === true)],
                    ["Tool surface", hermesStatus?.toolSurfaceReady ?? (hermesHealth?.runtimeHealth?.hermesMcpRegistered === true && (hermesHealth.runtimeHealth.hermesMcpToolCount ?? 0) > 0)],
                    ["Run", hermesStatus?.runReady ?? hermesHealth?.runtimeHealth?.runReady],
                    ["Career skills", hermesStatus?.careerSkillsReady ?? hermesHealth?.runtimeHealth?.careerSkillsLoaded === true]
                  ] as Array<[string, boolean | undefined]>).map(([label, ready]) => <span key={label} className={ready === true ? "is-ready" : "is-pending"}><b>{ready === true ? "✓" : "—"}</b>{label}</span>)}
                </div>
                <p className="settings-save-state">原因码：{hermesStatus?.reasonCode || hermesHealth?.reason || (hermesHealth?.available === true ? "health_endpoint_ready" : "正在读取 Supervisor 状态")}</p>
              </section>

              <section className="settings-group hermes-control-section" aria-labelledby="hermes-tools-heading">
                <div className="settings-group-heading">
                  <div><h3 id="hermes-tools-heading">Career 工具面</h3><p>两个数量分别表示内部 Domain 合同面与 Hermes 生产可见 Career 工具面。</p></div>
                </div>
                <dl className="info-list hermes-control-facts">
                  <div><dt>CareerAdapt Domain tools</dt><dd>{hermesStatus?.careerDomainToolCount ?? hermesHealth?.runtimeHealth?.careerGatewayContracts?.length ?? 0}</dd></div>
                  <div><dt>Hermes production Career tools</dt><dd>{hermesStatus?.hermesCareerToolCount ?? hermesHealth?.runtimeHealth?.careerMcpExposedTools?.length ?? 0}</dd></div>
                  <div><dt>Required Career facades</dt><dd>{hermesStatus ? `${hermesStatus.requiredCareerFacadesReady}/${hermesStatus.requiredCareerFacadesTotal}` : `${Math.max(0, 8 - (hermesHealth?.runtimeHealth?.requiredCareerFacadesMissing?.length ?? 8))}/8`}</dd></div>
                  <div><dt>Career skills</dt><dd>{hermesStatus ? `${hermesStatus.careerSkillsReady ? "已加载" : "同步中"}${hermesStatus.careerSkills?.length ? ` · ${hermesStatus.careerSkills.join(", ")}` : ""}` : hermesHealth?.runtimeHealth?.careerSkillsLoaded === true ? "已加载" : "同步中"}</dd></div>
                </dl>
              </section>

              <p className="settings-save-state" role="status" aria-live="polite">{hermesFeedback}</p>
              <div className="hermes-settings-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={hermesStarting}
                  onClick={() => void startHermesFromSettings()}
                >
                  {hermesStarting ? "处理中…" : "启动 / 重载"}
                </button>
                <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void stopHermesFromSettings()}><Power size={14} aria-hidden="true" />停止</button>
                <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void restartHermesFromSettings()}><RotateCcw size={14} aria-hidden="true" />重启</button>
                <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void runHermesControl(requestHermesRecover, "已执行一次自动修复检查。")}><Wrench size={14} aria-hidden="true" />自动修复</button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={hermesChecking || hermesStarting}
                  onClick={() => { void checkHermesHealth(); void getHermesStatus().then((status) => { if (status) setHermesStatus(status); }); }}
                >
                  {hermesChecking ? "读取中…" : "刷新状态"}
                </button>
                <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => { void refreshHermesLogs(); }}><FileText size={14} aria-hidden="true" />查看日志</button>
                <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => { void openHermesLogFile(); }}><FileText size={14} aria-hidden="true" />打开日志目录</button>
              </div>
              {hermesLogs ? (
                <details className="settings-help-details hermes-log-details" open>
                  <summary>安全日志与 Supervisor timeline</summary>
                  <p>{hermesLogs.logPath || "日志路径由 Electron 管理"}</p>
                  <pre>{[...hermesLogs.latestLifecycleEntries.map((entry) => `${entry.at} [${entry.state}] ${entry.message}`), ...hermesLogs.recentLogLines].join("\n") || "暂无日志"}</pre>
                </details>
              ) : null}
              {hermesConfigSchema ? (
                <details className="settings-help-details">
                  <summary>Bundled runtime contract · {hermesConfigSchema.version || "版本读取中"}</summary>
                  <p>可探测接口：{hermesConfigSchema.supportedEndpoints.join("、") || "无"}。当前版本不提供：{hermesConfigSchema.unsupportedEndpoints.join("、") || "无"}。Host、鉴权、CareerAdapt production MCP、工具面和 runtime 路径由应用锁定。</p>
                </details>
              ) : null}
              <details className="settings-help-details">
                <summary>端口说明</summary>
                <p>应用启动时会分别探测 CareerAdapt 和 Hermes 的可用本地端口。默认端口只是首选值；如果被其他程序占用，应用会自动顺延到可用端口，并同步更新 MCP 与 Hermes 配置。</p>
              </details>
            </div>
          ) : null}

          {category === "export" ? (
            <div className="settings-section">
              <h2>导出行为</h2>
              <dl className="info-list">
                <div><dt>A4 纸张</dt><dd>始终保持白色预览与导出。</dd></div>
                <div><dt>PDF</dt><dd>不受应用明亮或暗黑主题影响。</dd></div>
                <div><dt>模板颜色</dt><dd>由简历工作台的模板设置控制。</dd></div>
              </dl>
            </div>
          ) : null}

          {category === "data" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>归档任务</h2>
                  <p>已归档的 AI 任务会从侧栏隐藏，可在此恢复或永久删除。</p>
                </div>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={archivedLoading}
                  onClick={() => {
                    setArchivedLoading(true);
                    void sessionStoreRef.current.listArchived().then((items) => {
                      setArchivedSessions(items);
                      setArchivedLoading(false);
                    });
                  }}
                >
                  {archivedLoading ? "加载中…" : "刷新"}
                </button>
              </div>
              {archivedSessions.length === 0 ? (
                <p className="settings-empty-note">暂无归档任务。</p>
              ) : (
                <ul className="settings-archive-list">
                  {archivedSessions.map((session) => (
                    <li key={session.id} className="settings-archive-item">
                      <div className="settings-archive-info">
                        <strong>{session.title}</strong>
                        <small>归档于 {session.archivedAt ? new Date(session.archivedAt).toLocaleDateString("zh-CN") : "未知"}</small>
                      </div>
                      <div className="settings-archive-actions">
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => {
                            void sessionStoreRef.current.unarchive(session.id).then(() => {
                              setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id));
                              window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
                              notify({ type: "success", title: "已恢复", message: `「${session.title}」已恢复到侧栏。` });
                            });
                          }}
                        >
                          <RotateCcw size={14} aria-hidden="true" /> 恢复
                        </button>
                        <button
                          className="secondary-button compact danger-text"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`永久删除「${session.title}」？此操作不可撤销。`)) return;
                            void sessionStoreRef.current.delete(session.id).then(() => {
                              setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id));
                              notify({ type: "success", title: "已删除", message: `「${session.title}」已永久删除。` });
                            });
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" /> 删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {category === "data" ? (
            <div className="settings-section">
              <h2>导出任务数据</h2>
              <p>将所有 AI 任务（含对话历史、工作流状态和产物引用）导出为 JSON 文件。</p>
              <button
                className="secondary-button compact"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => {
                  void sessionStoreRef.current.list(999).then(async (active) => {
                    const archived = await sessionStoreRef.current.listArchived(999);
                    const all = [...active, ...archived];
                    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `careeradapt-ai-tasks-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    notify({ type: "success", title: "导出成功", message: `已导出 ${all.length} 条任务。` });
                  });
                }}
              >
                导出全部任务
              </button>
            </div>
          ) : null}

          {category === "help" ? (
            <div className="settings-section">
              <h2>帮助</h2>
              <p>常用说明保留在设置分类中，不占用主工作区。</p>
            </div>
          ) : null}

          {category === "developer" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>开发者模式</h2>
                  <p>仅用于清理开发期间产生的测试数据，不改变正常用户的删除流程。</p>
                </div>
              </div>
              <label className="settings-toggle-row">
                <span><strong>启用快速清理</strong><small>回收站可一次清理所有未被引用的内容；受简历、岗位或求职记录引用的数据仍会保留。</small></span>
                <input
                  type="checkbox"
                  checked={developerMode}
                  onChange={(event) => {
                    setDeveloperMode(event.target.checked);
                    writeDeveloperMode(event.target.checked);
                  }}
                />
              </label>

              <section className="settings-group core-self-check-group" aria-labelledby="core-self-check-heading">
                <div className="settings-group-heading">
                  <div>
                    <h3 id="core-self-check-heading">P4.5 核心闭环诊断</h3>
                    <p>读取当前运行中的 Hermes、Career MCP、Profile、通用简历和真实页面投影；只展示安全计数与标识，不导出正文。</p>
                  </div>
                  <span className={`status-badge core-self-check-badge is-${coreSelfCheck?.overallStatus?.toLowerCase() ?? "idle"}`}>
                    {coreSelfCheck ? coreCheckStatusLabel(coreSelfCheck.overallStatus) : "未运行"}
                  </span>
                </div>
                <div className="core-self-check-actions">
                  <button type="button" className="primary-button compact" disabled={coreSelfChecking || coreRepairing} onClick={() => { void runCoreClosureSelfCheck(); }}>
                    {coreSelfChecking ? "自检中…" : "运行核心闭环自检"}
                  </button>
                  <button type="button" className="secondary-button compact" disabled={!coreSelfCheck || coreSelfChecking || coreRepairing} onClick={exportCoreClosureSelfCheck}>
                    导出安全诊断
                  </button>
                </div>
                {coreSelfCheck ? (
                  <>
                    <dl className="document-engine-facts core-self-check-facts">
                      <div><dt>runId</dt><dd>{coreSelfCheck.runId}</dd></div>
                      <div><dt>logicalTurnId</dt><dd>{coreSelfCheck.logicalTurnId}</dd></div>
                      <div><dt>logicalToolOperationId</dt><dd>{coreSelfCheck.logicalToolOperationId}</dd></div>
                      <div><dt>Profile</dt><dd>{coreSelfCheck.profileId ? `${coreSelfCheck.profileId} · revision ${coreSelfCheck.profileRevision}` : "未读取"}</dd></div>
                      <div><dt>TurnTargetContext</dt><dd>{coreSelfCheck.turnTargetContextId ?? "未生成"}</dd></div>
                    </dl>
                    <div className="core-self-check-grid">
                      {([
                        ["Hermes runtime", coreSelfCheck.checks.hermesRuntime],
                        ["Career MCP", coreSelfCheck.checks.careerMcp],
                        ["Contract version/hash", coreSelfCheck.checks.careerContract],
                        ["Active Profile", coreSelfCheck.checks.activeProfileReadability],
                        ["General Resume", coreSelfCheck.checks.generalResumeReadability],
                        ["Profile integrity", coreSelfCheck.checks.profileContentIntegrity],
                        ["Browser MCP round-trip", coreSelfCheck.checks.browserMcpRoundTrip],
                        ["logicalToolOperationId", coreSelfCheck.checks.logicalToolOperationIdCorrelation],
                        ["TurnTargetContext", coreSelfCheck.checks.turnTargetContext],
                        ["Checkpoint invariant", coreSelfCheck.checks.workflowCheckpointInvariants],
                        ["Repository read-back", coreSelfCheck.checks.repositoryReadback]
                      ] as Array<[string, { status: string; reason?: string }]>).map(([label, check]) => (
                        <div key={label} className="core-self-check-row">
                          <span>{label}</span>
                          <strong className={`core-check-status is-${check.status.toLowerCase()}`}>{coreCheckStatusLabel(check.status as "PASS" | "FAIL" | "NOT_APPLICABLE")}</strong>
                          {check.reason ? <small>{check.reason}</small> : null}
                        </div>
                      ))}
                    </div>
                    {coreSelfCheck.profileContentIntegrity ? (
                      <details className="settings-help-details" open>
                        <summary>Profile content integrity · {coreSelfCheck.profileIntegrityClassification}</summary>
                        <dl className="document-engine-facts core-self-check-counts">
                          <div><dt>Repository project</dt><dd>{coreSelfCheck.profileContentIntegrity.repository.projectCount} 条 / 描述 {coreSelfCheck.profileContentIntegrity.repository.projectDescriptionCount} / bullet {coreSelfCheck.profileContentIntegrity.repository.projectHighlightCount}</dd></div>
                          <div><dt>Repository work / internship</dt><dd>{coreSelfCheck.profileContentIntegrity.repository.workCount} 条 / bullet {coreSelfCheck.profileContentIntegrity.repository.workHighlightCount} · {coreSelfCheck.profileContentIntegrity.repository.internshipCount} 条 / bullet {coreSelfCheck.profileContentIntegrity.repository.internshipHighlightCount}</dd></div>
                          <div><dt>Adapter / Form / Editor</dt><dd>{coreSelfCheck.profileContentIntegrity.adapter.paragraphCount}/{coreSelfCheck.profileContentIntegrity.adapter.bulletCount} · {coreSelfCheck.profileContentIntegrity.form.paragraphCount}/{coreSelfCheck.profileContentIntegrity.form.bulletCount} · {coreSelfCheck.profileContentIntegrity.editor.visibleParagraphCount}/{coreSelfCheck.profileContentIntegrity.editor.visibleBulletCount}</dd></div>
                          <div><dt>General Resume</dt><dd>{coreSelfCheck.profileContentIntegrity.generalResume.projectCount} 个项目 / bullet {coreSelfCheck.profileContentIntegrity.generalResume.projectHighlightCount} · work bullet {coreSelfCheck.profileContentIntegrity.generalResume.workHighlightCount}</dd></div>
                        </dl>
                      </details>
                    ) : null}
                    {coreSelfCheck.repairCandidates.length > 0 ? (
                      <section className="core-repair-section" aria-labelledby="core-repair-heading">
                        <div className="settings-group-heading">
                          <div>
                            <h4 id="core-repair-heading">资料恢复候选</h4>
                            <p>不会在页面加载时写入。选择来源并确认后，系统创建新的 Profile 版本、原子写入、读回并重新自检。</p>
                          </div>
                        </div>
                        <div className="core-repair-candidates">
                          {coreSelfCheck.repairCandidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              className={selectedRepairCandidateId === candidate.id ? "core-repair-candidate is-selected" : "core-repair-candidate"}
                              onClick={() => setSelectedRepairCandidateId(candidate.id)}
                            >
                              <strong>{candidate.sourceLabel}</strong>
                              <span>影响 {candidate.affectedEntityCount} 条 · 候选 bullet {candidate.candidateBulletCount}</span>
                              <small>冲突 {candidate.conflictCount} · 不变 {candidate.unchangedItemCount}</small>
                            </button>
                          ))}
                        </div>
                        {coreSelfCheck.repairRequired ? (
                          <button type="button" className="secondary-button compact" disabled={coreRepairing || coreSelfChecking} onClick={() => { void repairProfileContent(); }}>
                            {coreRepairing ? "修复并校验中…" : "修复资料内容"}
                          </button>
                        ) : null}
                      </section>
                    ) : null}
                  </>
                ) : (
                  <p className="settings-save-state">尚未运行。诊断不会启动新的 AI 任务，也不会修改 Profile。</p>
                )}
              </section>

              <section className="settings-group" aria-labelledby="orphaned-data-heading">
                <div className="settings-group-heading">
                  <div>
                    <h3 id="orphaned-data-heading">孤儿数据清理</h3>
                    <p>删除个人资料后，关联的导入草稿、原始输入和 PDF 会话仍留在数据库中。这里可以清除它们。</p>
                  </div>
                  <button type="button" className="secondary-button compact" disabled={orphanedLoading} onClick={() => { void scanOrphanedData(); }}>
                    {orphanedLoading ? "扫描中…" : "重新扫描"}
                  </button>
                </div>
                {orphanedCounts ? (
                  <>
                    <dl className="document-engine-facts">
                      <div><dt>导入草稿</dt><dd>{orphanedCounts.drafts} 条</dd></div>
                      <div><dt>原始输入</dt><dd>{orphanedCounts.rawInputs} 条</dd></div>
                      <div><dt>PDF 会话</dt><dd>{orphanedCounts.pdfSessions} 条</dd></div>
                    </dl>
                    {orphanedCounts.drafts + orphanedCounts.rawInputs + orphanedCounts.pdfSessions > 0 ? (
                      <button type="button" className="danger-button" disabled={orphanedClearing} onClick={() => { void clearOrphanedData(); }}>
                        {orphanedClearing ? "清理中…" : "清除所有孤儿数据"}
                      </button>
                    ) : (
                      <p className="settings-save-state">没有孤儿数据，数据库干净。</p>
                    )}
                  </>
                ) : (
                  <p className="settings-save-state">{orphanedLoading ? "正在扫描数据库…" : "点击重新扫描查看孤儿数据。"}</p>
                )}
              </section>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function HealthBadge({ health }: { health?: DocumentEngineHealth }) {
  const label = !health ? "未配置" : health.status === "ready" ? "可用" : health.status === "loading" ? "加载中" : health.status === "missing" ? "未配置" : "不可用";
  return <span className={`status-badge status-badge-${health?.status ?? "missing"}`}>{label}</span>;
}

function HealthText({ health }: { health?: DocumentEngineHealth }) {
  if (!health) return <>尚未检测</>;
  return <>{health.status === "ready" ? "可用" : health.status === "loading" ? "加载中" : health.status === "missing" ? "未配置" : "不可用"}{health.version ? ` · ${health.version}` : ""}{health.message ? ` · ${health.message}` : ""}</>;
}

function formatEndpoint(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
  }
}

function coreCheckStatusLabel(status: "PASS" | "FAIL" | "NOT_APPLICABLE" | "idle") {
  if (status === "PASS") return "通过";
  if (status === "FAIL") return "失败";
  if (status === "NOT_APPLICABLE") return "不适用";
  return "未运行";
}

function hermesLifecycleState(status?: HermesSupervisorSnapshot, health?: HermesSettingsHealth): HermesSupervisorSnapshot["overallState"] {
  if (status) return status.overallState;
  if (health?.available === true) return "ready";
  return "starting";
}

function hermesLifecycleLabel(status?: HermesSupervisorSnapshot, health?: HermesSettingsHealth) {
  const state = hermesLifecycleState(status, health);
  return {
    stopped: "Stopped",
    starting: "Starting",
    api_ready: "API ready",
    syncing_career_tools: "Syncing Career tools",
    ready: "Ready",
    degraded: "Degraded",
    restarting: "Restarting",
    unavailable: "Unavailable",
    stopping: "Stopping"
  }[state];
}

function hermesFeedbackForState(status: HermesSupervisorSnapshot) {
  if (status.overallState === "ready") return "Hermes Ready：进程、API、Provider、Career MCP、工具面和 Run 均已就绪。";
  if (status.overallState === "syncing_career_tools") return "Hermes API 已就绪，正在同步 Career production tool surface。";
  if (status.overallState === "degraded") return `Hermes 处于降级状态：${status.reasonCode ?? "请查看 readiness dimensions"}。`;
  if (status.overallState === "unavailable") return `Hermes 当前不可用：${status.reasonCode ?? "请检查配置或日志"}。`;
  return `Hermes 状态：${hermesLifecycleLabel(status)}。`;
}

function loadingHealth(engine: string): DocumentEngineHealth {
  return { engine, status: "loading", message: "正在检查…" };
}

function applyPreferences(theme: ThemePreference, density: DensityPreference) {
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.density = density;
  document.documentElement.style.colorScheme = resolvedTheme;
  window.dispatchEvent(new Event("careeradapt-preferences-change"));
}

function readThemePreference(): ThemePreference {
  const value = window.localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readDensityPreference(): DensityPreference {
  const value = window.localStorage.getItem(densityStorageKey);
  return value === "compact" || value === "comfortable" ? value : "compact";
}
