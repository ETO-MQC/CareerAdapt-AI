"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { clearAiSettings, readAiSettings, writeAiSettings, type AiSettings } from "@/services/storage/aiSettings";
import { normalizeAiRuntimeConfigDraft, validateAiRuntimeConfigDraft } from "@/services/agent/aiRuntimeConfiguration";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { AgentSession } from "@/agent/contracts/agentSession";
import {
  getHermesLogs,
  hermesControlFeedback,
  hermesControlStatusLabel,
  hermesRuntimeEnvironment,
  openHermesLogs,
  requestHermesRecover,
  requestHermesConfigReset,
  requestHermesConfigUpdate,
  requestHermesEnvironmentReload,
  requestHermesProviderTest,
  requestHermesRestart,
  requestHermesStart,
  requestHermesStop,
  type HermesProviderTestResult,
  type HermesControlResult,
  type HermesLogs,
  createInitialHermesControlSnapshot
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

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";

const categories: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: "appearance", label: "界面", description: "主题与显示密度" },
  { id: "document", label: "文档识别", description: "PDF、DOCX 与本地 OCR" },
  { id: "ai", label: "AI 配置", description: "接口与模型设置" },
  { id: "hermes", label: "AI Agent", description: "服务与 Career 工具状态" },
  { id: "export", label: "导出", description: "A4 与 PDF 行为" },
  { id: "data", label: "数据管理", description: "归档任务与回收站" },
  { id: "developer", label: "开发者模式", description: "测试数据清理" },
  { id: "help", label: "帮助", description: "说明入口" }
];

export default function SettingsPage() {
  const agentHost = useAgentHost();
  const runtimeStatus = useSyncExternalStore(agentHost.runtimeStatus.subscribe, agentHost.runtimeStatus.getSnapshot, agentHost.runtimeStatus.getSnapshot);
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
  const aiSavingRef = useRef(false);
  const aiTestingRef = useRef(false);
  const [candidateProviderTest, setCandidateProviderTest] = useState<HermesProviderTestResult>();
  const [hermesLogs, setHermesLogs] = useState<HermesLogs>();
  const [hermesStarting, setHermesStarting] = useState(false);
  const [hermesFeedback, setHermesFeedback] = useState("应用启动时会自动启动 AI Agent；异常退出后可在此恢复。");
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
    const importedDraft = await repository.getLatestImportedResumeDraftForProfile(profile.id);
    const candidates = buildProfileRecoveryCandidates({ profile, importedDraft, generalResume });
    const candidate = candidates.find((item) => item.id === selectedRepairCandidateId)
      ?? candidates.find((item) => item.affectedEntityCount > 0);
    if (!candidate || candidate.affectedEntityCount === 0) {
      notify({ type: "info", title: "没有可修复内容", message: "当前没有新的、已确认且可安全回填的资料来源。" });
      return;
    }
    if (!window.confirm(`将使用「${candidate.sourceLabel}」在当前 Profile 上写入 revision +1，影响 ${candidate.affectedEntityCount} 个条目。继续吗？`)) return;
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
      notify({ type: "success", title: "资料内容已修复", message: `已写入同一 Profile 的 revision ${repaired.profileVersion} 并完成读回校验（${repaired.profileId}）。` });
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

  async function testHermesProviderFromSettings() {
    if (aiTestingRef.current || aiTesting) return;
    aiTestingRef.current = true;
    setAiTesting(true);
    try {
      const result = await requestHermesProviderTest(aiSettings);
      setCandidateProviderTest(result);
    } catch (error) {
      setCandidateProviderTest({
        ok: false,
        provider: aiSettings.provider,
        model: aiSettings.model || undefined,
        credentialConfigured: Boolean(aiSettings.apiKey.trim()),
        credentialSource: aiSettings.apiKey.trim() ? "custom_header" : "unknown",
        checkedAt: new Date().toISOString(),
        safeErrorCode: "provider_unavailable",
        message: error instanceof Error ? error.message : "无法连接 API 地址，请检查地址和网络。"
      });
    } finally {
      aiTestingRef.current = false;
      setAiTesting(false);
    }
  }

  async function stopCurrentRunFromSettings() {
    const session = agentHost.state.getSnapshot().activeSession;
    const runId = hermesSnapshot.activeRunId ?? session?.hermesRun?.runId;
    if (!session || !runId) {
      setHermesFeedback("当前没有可停止的 Hermes Run。");
      return;
    }
    setHermesStarting(true);
    try {
      await agentHost.interruptRun(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "user_stop",
        sourceComponent: "SettingsPage.stopCurrentRun",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
      setHermesFeedback("已请求停止当前 Hermes Run；运行状态会由 AI Agent 自动更新。");
    } catch (error) {
      setHermesFeedback(error instanceof Error ? error.message : "停止当前 Hermes Run 失败，请稍后重试。" );
    } finally {
      setHermesStarting(false);
    }
  }

  async function reconnectCareerToolsFromSettings() {
    if (hermesStarting) return;
    setHermesStarting(true);
    try {
      await agentHost.mcpBridge.reconnect();
      setHermesFeedback("Career 工具正在重新连接。" );
    } catch (error) {
      setHermesFeedback(error instanceof Error ? error.message : "Career 工具连接失败。" );
    } finally {
      setHermesStarting(false);
    }
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("category");
    const timer = window.setTimeout(() => {
      if (categories.some((item) => item.id === requested)) setCategory(requested as SettingsCategory);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function startHermesFromSettings() {
    if (hermesStarting) return;
    setHermesStarting(true);
    setHermesFeedback("正在启动 AI Agent API Server…");
    try {
      const result = await requestHermesStart();
      if (result.receipt && !result.receipt.accepted) {
        setHermesFeedback(result.reason === "web_control_disabled"
          ? "Web Supervisor 未启用，请设置 HERMES_WEB_CONTROL_ENABLED=true 后重启开发服务。"
          : "当前 Hermes 进程没有可用的控制权，请检查本地开发服务配置。");
        return;
      }
      if (!result.ok) throw new Error(result.reason ?? "Hermes 启动失败。");
      const snapshot = agentHost.runtimeStatus.getSnapshot().controlSnapshot;
      setHermesFeedback(snapshot ? hermesControlFeedback(snapshot) : "Hermes 已接受启动请求，正在同步 Career 工具。");
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
      if (result?.receipt && !result.receipt.accepted) {
        setHermesFeedback(result.reason === "web_control_disabled"
          ? "Web Supervisor 未启用，请设置 HERMES_WEB_CONTROL_ENABLED=true 后重启开发服务。"
          : "当前 Hermes 进程没有可用的控制权，请检查本地开发服务配置。");
        return;
      }
      if (result && !result.ok) throw new Error(result.reason ?? "Hermes 控制操作未完成。");
      const snapshot = agentHost.runtimeStatus.getSnapshot().controlSnapshot;
      setHermesFeedback(snapshot ? hermesControlFeedback(snapshot) : successMessage);
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
      hermesSnapshot.activeRunId
      || (session
        && (session.activeTurn?.status === "running"
          || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")))
    );
    if (activeRun && !window.confirm("当前 AI 任务正在执行。重启 AI Agent 会中断当前运行，但会保留任务进度；确定继续吗？")) return;
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
    if (aiSavingRef.current || aiSaving) return;
    const session = agentHost.state.getSnapshot().activeSession;
    let sessionBindingToRelease: string | undefined;
    const activeRun = Boolean(
      hermesSnapshot.activeRunId
      || (session
        && (session.activeTurn?.status === "running"
          || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")))
    );
    if (activeRun && !window.confirm("当前 AI 正在处理任务。切换模型需要停止当前运行，但对话和任务进度会保留。是否立即切换？")) return;
    aiSavingRef.current = true;
    setAiSaving(true);
    try {
      const draft = normalizeAiRuntimeConfigDraft(aiSettings);
      const validationReason = validateAiRuntimeConfigDraft(draft);
      if (validationReason) {
        setHermesFeedback(aiRuntimeConfigFeedback(validationReason));
        return;
      }
      writeAiSettings(draft);
      if (activeRun && session) {
        await agentHost.interruptRun(session.id, createRunStopReason({
          requestedBy: "user",
          reasonCode: "runtime_config_update",
          sourceComponent: "SettingsPage.saveAiConfiguration",
          sessionId: session.id,
          logicalTurnId: session.activeTurn?.id,
          runId: session.hermesRun?.runId,
          incidentTraceId: session.activeTurn?.incidentTraceId
        }));
      }
      const result = await requestHermesConfigUpdate(draft);
      const applyStatus = result.receipt?.applyStatus ?? result.snapshot?.runtimeConfig?.applyStatus;
      if (applyStatus === "applied") {
        setAiSaved(true);
        if (session) sessionBindingToRelease = session.id;
      }
      setHermesFeedback(result.ok
        ? hermesControlFeedback(result.controlSnapshot ?? agentHost.runtimeStatus.getSnapshot().controlSnapshot ?? hermesSnapshot)
        : aiRuntimeConfigFeedback(result.reason ?? applyStatus ?? "unknown"));
    } catch (error) {
      setHermesFeedback(error instanceof Error
        ? `AI 配置未应用：${error.message}`
        : "AI 配置未应用，请查看运行诊断后重试。");
    } finally {
      if (sessionBindingToRelease) agentHost.hermesRuntime?.releaseSessionBinding?.(sessionBindingToRelease);
      aiSavingRef.current = false;
      setAiSaving(false);
      window.setTimeout(() => setAiSaved(false), 2000);
    }
  }

  async function resetAiConfiguration() {
    if (aiSavingRef.current || aiSaving) return;
    const session = agentHost.state.getSnapshot().activeSession;
    let sessionBindingToRelease: string | undefined;
    const activeRun = Boolean(
      hermesSnapshot.activeRunId
      || (session
        && (session.activeTurn?.status === "running"
          || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")))
    );
    if (activeRun && !window.confirm("当前 AI 任务正在执行。恢复环境默认配置会中断当前运行，但会保留任务进度；确定继续吗？")) return;
    aiSavingRef.current = true;
    setAiSaving(true);
    try {
      setShowApiKey(false);
      if (activeRun && session) {
        await agentHost.interruptRun(session.id, createRunStopReason({
          requestedBy: "user",
          reasonCode: "runtime_config_reset",
          sourceComponent: "SettingsPage.resetAiConfiguration",
          sessionId: session.id,
          logicalTurnId: session.activeTurn?.id,
          runId: session.hermesRun?.runId,
          incidentTraceId: session.activeTurn?.incidentTraceId
        }));
      }
      clearAiSettings();
      const result = await requestHermesConfigReset();
      setAiSettings(readAiSettings());
      if (result.ok && session) sessionBindingToRelease = session.id;
      setHermesFeedback(result.ok
        ? hermesControlFeedback(result.controlSnapshot ?? agentHost.runtimeStatus.getSnapshot().controlSnapshot ?? hermesSnapshot)
        : aiRuntimeConfigFeedback(result.reason ?? "reset_failed"));
    } catch (error) {
      setHermesFeedback(error instanceof Error ? `恢复默认配置失败：${error.message}` : "恢复默认配置失败，请稍后重试。");
    } finally {
      if (sessionBindingToRelease) agentHost.hermesRuntime?.releaseSessionBinding?.(sessionBindingToRelease);
      aiSavingRef.current = false;
      setAiSaving(false);
    }
  }

  async function reloadHermesEnvironmentFromSettings() {
    if (hermesStarting || aiSavingRef.current || aiSaving) return;
    const session = agentHost.state.getSnapshot().activeSession;
    let sessionBindingToRelease: string | undefined;
    const activeRun = Boolean(
      hermesSnapshot.activeRunId
      || (session
        && (session.activeTurn?.status === "running"
          || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")))
    );
    if (activeRun && !window.confirm("当前 AI 任务正在执行。从环境文件重载会中断当前运行，但会保留任务进度；确定继续吗？")) return;
    aiSavingRef.current = true;
    setAiSaving(true);
    try {
      if (activeRun && session) {
        await agentHost.interruptRun(session.id, createRunStopReason({
          requestedBy: "user",
          reasonCode: "runtime_environment_reload",
          sourceComponent: "SettingsPage.reloadHermesEnvironment",
          sessionId: session.id,
          logicalTurnId: session.activeTurn?.id,
          runId: session.hermesRun?.runId,
          incidentTraceId: session.activeTurn?.incidentTraceId
        }));
      }
      clearAiSettings();
      const result = await requestHermesEnvironmentReload();
      setAiSettings(readAiSettings());
      if (result.ok && session) sessionBindingToRelease = session.id;
      setHermesFeedback(result.ok
        ? hermesControlFeedback(result.controlSnapshot ?? agentHost.runtimeStatus.getSnapshot().controlSnapshot ?? hermesSnapshot)
        : aiRuntimeConfigFeedback(result.reason ?? "reload_failed"));
    } catch (error) {
      setHermesFeedback(error instanceof Error ? `环境配置重载失败：${error.message}` : "环境配置重载失败，请稍后重试。");
    } finally {
      if (sessionBindingToRelease) agentHost.hermesRuntime?.releaseSessionBinding?.(sessionBindingToRelease);
      aiSavingRef.current = false;
      setAiSaving(false);
    }
  }

  const hermesSnapshot = runtimeStatus.controlSnapshot ?? createInitialHermesControlSnapshot(hermesRuntimeEnvironment());
  const activeConfig = hermesSnapshot.runtimeConfig.active;
  const applyStatus = hermesSnapshot.runtimeConfig.applyStatus;
  const lifecycleEntries = runtimeStatus.supervisorSnapshot?.latestLifecycleEntries ?? [];

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
                  <h2>AI 模型</h2>
                  <p>保存后由 AI Agent 验证并应用。当前运行中的模型会在切换完成前保持可见。</p>
                </div>
              </div>
              <section className="settings-group ai-runtime-settings-card" aria-labelledby="ai-runtime-config-heading">
                <div className="settings-group-heading">
                  <div><h3 id="ai-runtime-config-heading">当前模型</h3><p>活动配置只来自已验证的运行时；候选测试不会改变当前模型。</p></div>
                  <span className={`status-badge ${applyStatus === "applied" || applyStatus === "rolled_back" ? "status-badge-ready" : applyStatus === "failed" ? "status-badge-error" : "status-badge-loading"}`}>
                    {aiRuntimeApplyStatusLabel(applyStatus, Boolean(activeConfig))}
                  </span>
                </div>
                <div className="ai-runtime-current-model" aria-live="polite">
                  <strong>{activeConfig?.model || "尚未配置模型"}</strong>
                  <span>{activeConfig?.baseUrl || "使用应用默认 API 地址"}</span>
                </div>
                <div className="ai-runtime-fields">
                  <label className="field-label" htmlFor="ai-base-url">
                    API 地址
                    <input
                      id="ai-base-url"
                      name="aiBaseUrl"
                      type="url"
                      autoComplete="url"
                      value={aiSettings.baseUrl}
                      onChange={(event) => {
                        setAiSettings((prev) => ({ ...prev, baseUrl: event.target.value }));
                        setCandidateProviderTest(undefined);
                      }}
                      placeholder="https://api.example.com/v1…"
                    />
                  </label>
                  <label className="field-label" htmlFor="ai-api-key">
                    API Key
                    <div className="ai-api-key-field">
                      <input
                        id="ai-api-key"
                        name="aiApiKey"
                        type={showApiKey ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={aiSettings.apiKey}
                        onChange={(event) => {
                          setAiSettings((prev) => ({
                            ...prev,
                            apiKey: event.target.value,
                            credentialAction: event.target.value.trim() ? "replace" : prev.credentialAction
                          }));
                          setCandidateProviderTest(undefined);
                        }}
                        placeholder="输入本机 API Key…"
                      />
                      <button type="button" className="ai-api-key-toggle" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((prev) => !prev)}>
                        {showApiKey ? "隐藏" : "显示"}
                      </button>
                    </div>
                  </label>
                  <label className="field-label" htmlFor="ai-model">
                    模型
                    <input
                      id="ai-model"
                      name="aiModel"
                      type="text"
                      autoComplete="off"
                      value={aiSettings.model}
                      onChange={(event) => {
                        setAiSettings((prev) => ({ ...prev, model: event.target.value }));
                        setCandidateProviderTest(undefined);
                      }}
                      placeholder="例如 gpt-4o-mini…"
                    />
                  </label>
                </div>
              </section>
              <div className="settings-save-state" role="status" aria-live="polite">{hermesFeedback}</div>
              {candidateProviderTest ? (
                <p className={`ai-candidate-feedback ${candidateProviderTest.ok ? "is-success" : "is-error"}`} role="status" aria-live="polite">
                  {candidateProviderTestFeedback(candidateProviderTest)}
                  {!candidateProviderTest.ok && candidateNeedsApiKey(candidateProviderTest) ? <button type="button" className="inline-action-button" onClick={() => document.getElementById("ai-api-key")?.focus()}>修改 API Key</button> : null}
                </p>
              ) : null}
              <div className="hermes-settings-actions ai-runtime-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={aiTesting || aiSaving}
                  onClick={() => void testHermesProviderFromSettings()}
                >
                  {aiTesting ? "测试连接中…" : "测试连接"}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={aiSaving}
                  onClick={() => void saveAiConfiguration()}
                >
                  {aiSaving ? "正在应用模型…" : aiSaved ? "已应用 ✓" : "保存并应用"}
                </button>
              </div>
              <details className="settings-help-details ai-runtime-more">
                <summary>更多</summary>
                <p>协议：OpenAI 兼容接口。接口协议描述连接方式，不代表具体服务品牌。</p>
                <div className="hermes-settings-actions">
                  <button type="button" className="button button-secondary" disabled={aiSaving} onClick={() => void resetAiConfiguration()}>恢复默认配置</button>
                  <button type="button" className="button button-secondary" disabled={aiSaving || hermesStarting || hermesSnapshot.controlOwner === "external_environment"} onClick={() => void reloadHermesEnvironmentFromSettings()}>从环境加载</button>
                  <button type="button" className="button button-secondary" disabled={!aiSettings.apiKey && aiSettings.credentialAction !== "replace"} onClick={() => setAiSettings((prev) => ({ ...prev, apiKey: "", credentialAction: "clear" }))}>清除已保存 API Key</button>
                </div>
              </details>
            </div>
          ) : null}

          {category === "hermes" ? (
            <div className="settings-section">
              <div className="section-heading compact-heading">
                <div>
                  <h2>AI Agent</h2>
                  <p>AI Agent 负责连接模型、Career 工具和当前任务；运行状态由统一运行时观察器提供。</p>
                </div>
              </div>
              <section className="settings-group hermes-control-section" aria-labelledby="hermes-state-heading">
                <div className="settings-group-heading">
                  <div><h3 id="hermes-state-heading">运行状态</h3><p>“AI Agent Ready” 只表示 API、Provider、Career MCP、工具面和 Run 全部可用。</p></div>
                  <span className={`status-badge hermes-state-badge is-${hermesSnapshot.status}`}>{hermesControlStatusLabel(hermesSnapshot)}</span>
                </div>
                <div className="hermes-runtime-summary">
                  <div><span>Agent</span><strong>{hermesServiceStateLabel(hermesSnapshot.serviceState)}</strong></div>
                  <div><span>模型</span><strong>{activeConfig?.model || "未配置"}</strong></div>
                  <div><span>Career 工具</span><strong>{hermesSnapshot.careerMcpReady ? "已连接" : "待连接"}</strong></div>
                  <div><span>当前任务</span><strong>{hermesSnapshot.runReady ? "可运行" : hermesSnapshot.activeRunId ? "运行中" : "待命"}</strong></div>
                </div>
              </section>

              <p className="settings-save-state" role="status" aria-live="polite">{hermesFeedback}</p>
              <div className="hermes-settings-actions hermes-primary-action-row">
                {hermesSnapshot.capabilities.canStartService && (hermesSnapshot.serviceState === "stopped" || hermesSnapshot.serviceState === "unavailable") ? <button type="button" className="button button-primary" disabled={hermesStarting} onClick={() => void startHermesFromSettings()}>{hermesStarting ? "启动中…" : "启动 AI Agent"}</button> : null}
                {hermesSnapshot.capabilities.canRestartService && hermesSnapshot.serviceState !== "stopped" && hermesSnapshot.serviceState !== "unavailable" ? <button type="button" className="button button-primary" disabled={hermesStarting} onClick={() => void restartHermesFromSettings()}>{hermesStarting ? "重启中…" : "重启 AI Agent"}</button> : null}
                {!hermesSnapshot.capabilities.canStartService && !hermesSnapshot.capabilities.canRestartService ? <span className="settings-inline-note">当前由外部运行时管理</span> : null}
              </div>
              <details className="settings-help-details hermes-more-details">
                <summary>更多</summary>
                <div className="hermes-settings-actions">
                  {hermesSnapshot.capabilities.canStopService ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void stopHermesFromSettings()}><Power size={14} aria-hidden="true" />停止 AI Agent</button> : null}
                  {hermesSnapshot.capabilities.canRestartService ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void reloadHermesEnvironmentFromSettings()}>从环境加载</button> : null}
                  {hermesSnapshot.capabilities.canRecoverService ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void runHermesControl(requestHermesRecover, "已执行一次自动修复检查。")}><Wrench size={14} aria-hidden="true" />自动修复</button> : null}
                  {hermesSnapshot.capabilities.canStopCurrentRun ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => void stopCurrentRunFromSettings()}><Power size={14} aria-hidden="true" />停止当前任务</button> : null}
                  {!hermesSnapshot.careerMcpReady ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => { void reconnectCareerToolsFromSettings(); }}>重新连接 Career 工具</button> : null}
                </div>
              </details>
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

              <section className="settings-group hermes-control-section" aria-labelledby="ai-runtime-diagnostics-heading">
                <div className="settings-group-heading">
                  <div>
                    <h3 id="ai-runtime-diagnostics-heading">AI Runtime 诊断</h3>
                    <p>仅在开发者模式查看运行时细节；普通 AI Agent 页面只保留状态、模型和可执行操作。</p>
                  </div>
                  <span className="status-badge">{hermesControlStatusLabel(hermesSnapshot)}</span>
                </div>
                <dl className="info-list hermes-control-facts">
                  <div><dt>服务进程</dt><dd>{hermesServiceStateLabel(hermesSnapshot.serviceState)} · {hermesSnapshot.controlOwner === "electron_supervisor" ? "Electron Supervisor" : hermesSnapshot.controlOwner === "web_supervisor" ? "Web Supervisor" : "外部环境"}</dd></div>
                  <div><dt>Runtime URL / 版本</dt><dd>{formatEndpoint(hermesSnapshot.runtimeUrl, "正在分配")}{hermesSnapshot.version ? " · " + hermesSnapshot.version : ""}</dd></div>
                  <div><dt>应用 / MCP URL</dt><dd>{formatEndpoint(hermesSnapshot.appUrl, "当前应用端口")}</dd></div>
                  <div><dt>Provider Base URL</dt><dd>{activeConfig?.baseUrl || "未确认"}</dd></div>
                  <div><dt>Provider / 模型</dt><dd>{activeConfig?.provider || "未确认"} · {activeConfig?.model || "未确认"}</dd></div>
                  <div><dt>凭证状态 / 来源</dt><dd>{hermesSnapshot.providerDiagnostic.credentialConfigured ? "已配置（仅显示状态）" : "未配置"} · {credentialSourceLabel(hermesSnapshot.providerDiagnostic.credentialSource)}</dd></div>
                  <div><dt>最近检查</dt><dd>{hermesSnapshot.providerDiagnostic.lastCheckedAt ? new Date(hermesSnapshot.providerDiagnostic.lastCheckedAt).toLocaleString() : "尚未检查"}{hermesSnapshot.providerDiagnostic.lastHttpStatus ? " · HTTP " + hermesSnapshot.providerDiagnostic.lastHttpStatus : ""}</dd></div>
                  <div><dt>配置应用 / generation</dt><dd>{applyStatus}{activeConfig?.configGeneration === undefined ? "" : " · " + activeConfig.configGeneration}</dd></div>
                  <div><dt>Fingerprint</dt><dd>{activeConfig?.configFingerprint || "未确认"}</dd></div>
                  <div><dt>数据上下文</dt><dd>{hermesSnapshot.storage.storageEnvironment} · {hermesSnapshot.storage.storageOrigin} · {hermesSnapshot.storage.storagePartition} · {hermesSnapshot.storage.activeProfileSource}</dd></div>
                </dl>
                <h4>Readiness dimensions</h4>
                <div className="hermes-dimension-grid">
                  {([
                    ["API", hermesSnapshot.apiReady],
                    ["Provider", hermesSnapshot.providerReady],
                    ["Career MCP", hermesSnapshot.careerMcpReady],
                    ["Tool surface", hermesSnapshot.toolSurfaceReady],
                    ["Run", hermesSnapshot.runReady]
                  ] as Array<[string, boolean]>).map(([label, ready]) => <span key={label} className={ready ? "is-ready" : "is-pending"}><b>{ready ? "✓" : "—"}</b>{label}</span>)}
                </div>
                <dl className="info-list hermes-control-facts">
                  <div><dt>安全 / 内部原因</dt><dd>{hermesSnapshot.safeReasonCode ?? "none"} · {hermesSnapshot.diagnosticReasonCode ?? "none"}</dd></div>
                  <div><dt>Provider / API 状态</dt><dd>{hermesSnapshot.providerState} · {hermesSnapshot.apiState} · environment {hermesSnapshot.environment}</dd></div>
                  <div><dt>CareerAdapt Domain tools</dt><dd>{hermesSnapshot.careerDomainToolCount ?? 0}</dd></div>
                  <div><dt>Hermes production Career tools</dt><dd>{hermesSnapshot.hermesCareerToolCount ?? 0}</dd></div>
                  <div><dt>Required Career facades</dt><dd>{hermesSnapshot.careerIntegration.requiredToolCount}/{hermesSnapshot.careerIntegration.requiredToolTotal}</dd></div>
                  <div><dt>Career skills</dt><dd>{hermesSnapshot.careerSkillsReady ? "已加载" : "同步中"}{hermesSnapshot.careerSkills?.length ? " · " + hermesSnapshot.careerSkills.join(", ") : ""}</dd></div>
                </dl>
                <details className="settings-help-details" open>
                  <summary>Supervisor timeline</summary>
                  <pre>{lifecycleEntries.map((entry) => entry.at + " [" + entry.state + "] " + entry.message).join("\n") || "暂无 timeline"}</pre>
                </details>
                <div className="hermes-settings-actions">
                  {hermesSnapshot.environment === "electron" ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => { void refreshHermesLogs(); }}><FileText size={14} aria-hidden="true" />查看日志</button> : null}
                  {hermesSnapshot.environment === "electron" ? <button type="button" className="button button-secondary" disabled={hermesStarting} onClick={() => { void openHermesLogFile(); }}><FileText size={14} aria-hidden="true" />打开日志目录</button> : null}
                </div>
                {hermesLogs ? (
                  <details className="settings-help-details hermes-log-details" open>
                    <summary>完整运行日志</summary>
                    <p>{hermesLogs.logPath || "日志路径由 Electron 管理"}</p>
                    <pre>{[...hermesLogs.latestLifecycleEntries.map((entry) => entry.at + " [" + entry.state + "] " + entry.message), ...hermesLogs.recentLogLines].join("\n") || "暂无日志"}</pre>
                  </details>
                ) : null}
              </section>

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
                      <div><dt>sourceUserMessageId</dt><dd>{coreSelfCheck.sourceUserMessageId ?? "未解析"}</dd></div>
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
                        ["Current UserMessage", coreSelfCheck.checks.currentTurnUserMessage],
                        ["Workflow preparation", coreSelfCheck.checks.workflowPreparation],
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
                    {coreSelfCheck.profileIntegrityClassification === "repository_content_missing" ? (
                      <div className="core-repair-alert" role="status">
                        <strong>检测到资料内容缺失</strong>
                        <span>
                          当前 Profile 中项目 {coreSelfCheck.profileContentIntegrity?.repository.projectCount ?? 0} 个、工作经历 {coreSelfCheck.profileContentIntegrity?.repository.workCount ?? 0} 个；
                          可从已确认来源恢复项目 bullet {coreSelfCheck.repairCandidates[0]?.projectBulletCount ?? 0} 条、工作 bullet {coreSelfCheck.repairCandidates[0]?.workBulletCount ?? 0} 条。
                        </span>
                      </div>
                    ) : null}
                    {coreSelfCheck.repairCandidates.length > 0 ? (
                      <section className="core-repair-section" aria-labelledby="core-repair-heading">
                        <div className="settings-group-heading">
                          <div>
                            <h4 id="core-repair-heading">修复资料内容</h4>
                            <p>不会在页面加载时写入。选择来源并确认后，系统在同一 Profile 上提交 revision +1，原子写入、读回并重新自检。</p>
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
                              <span>项目 {candidate.projectCount} 个 / bullet {candidate.projectBulletCount} · 工作 {candidate.workCount} 个 / bullet {candidate.workBulletCount}</span>
                              <small>影响 {candidate.affectedEntityCount} 条 · 冲突 {candidate.conflictCount} · 置信度 {candidate.confidence}</small>
                            </button>
                          ))}
                        </div>
                        {coreSelfCheck.repairRequired ? (
                          <button type="button" className="secondary-button compact" disabled={coreRepairing || coreSelfChecking} onClick={() => { void repairProfileContent(); }}>
                            {coreRepairing ? "修复并校验中…" : "确认修复"}
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

function hermesServiceStateLabel(state: "stopped" | "starting" | "running" | "stopping" | "unavailable") {
  return {
    stopped: "已停止",
    starting: "启动中",
    running: "运行中",
    stopping: "正在停止",
    unavailable: "不可用"
  }[state];
}

function credentialSourceLabel(source: "server_env" | "managed_config" | "custom_header" | "default" | "missing" | "unknown") {
  return {
    server_env: "服务环境",
    managed_config: "桌面版托管配置",
    custom_header: "当前设置",
    default: "默认值",
    missing: "未配置",
    unknown: "未确认"
  }[source];
}

function aiRuntimeApplyStatusLabel(status: string, hasActiveConfig: boolean) {
  if (status === "applied") return "Ready";
  if (status === "rolled_back") return "已回滚";
  if (status === "failed") return "应用失败";
  if (["validating", "testing", "saving", "restarting_runtime", "verifying"].includes(status)) return "正在应用模型…";
  if (status === "deferred") return "等待应用";
  if (status === "idle" && hasActiveConfig) return "Ready";
  return "未确认";
}

function candidateProviderTestFeedback(result: HermesProviderTestResult) {
  if (result.ok) return `✓ 连接正常${result.latencyMs === undefined ? "" : ` · ${result.latencyMs} ms`}`;
  const descriptions: Record<string, string> = {
    missing_ai_config: "请填写 API Key 和模型后再测试。",
    provider_protocol_mismatch: "请确认 API 地址提供 OpenAI 兼容接口。",
    provider_http_401: "API Key 无效或没有模型权限。",
    provider_http_403: "API Key 无效或没有模型权限。",
    provider_model_not_found: "未找到这个模型，请检查模型名称。",
    provider_dns_failed: "无法连接 API 地址，请检查地址和网络。",
    provider_connection_failed: "无法连接 API 地址，请检查地址和网络。",
    provider_timeout: "无法连接 API 地址，请检查地址和网络。",
    provider_http_429: "请求过于频繁，请稍后再试。",
    provider_http_500: "模型服务内部错误，请稍后再试。",
    provider_http_502: "网关错误，请检查 API 地址。",
    provider_http_503: "模型服务暂时不可用，请稍后再试。",
    model_output_too_large: "模型返回内容过长，但连接本身正常。",
  };
  return descriptions[result.safeErrorCode ?? ""] ?? result.message ?? "请检查 API 地址、模型和凭证。";
}

function candidateNeedsApiKey(result: HermesProviderTestResult) {
  return result.safeErrorCode === "provider_http_401" || result.safeErrorCode === "provider_http_403";
}

function aiRuntimeConfigFeedback(reason: string) {
  const descriptions: Record<string, string> = {
    provider_base_url_invalid: "API 地址格式无效，请填写完整的 http(s) 地址。",
    provider_base_url_protocol_invalid: "API 地址必须使用 http 或 https。",
    provider_identity_must_not_be_url: "API 地址请填写在 API 地址字段中。",
    credential_clear_conflict: "清除 API Key 时不要同时填写新的 Key。",
    credential_replace_missing: "替换 API Key 时请先填写新的 Key。",
    missing_ai_config: "请填写 API Key 和模型后再应用。",
    config_deferred_active_run: "当前任务仍在运行；请确认后应用新配置。",
    config_rollback_failed: "新配置未通过验证，旧配置也未能恢复，请查看诊断。",
    config_apply_rolled_back: "新配置未通过验证，已恢复到原来的模型。",
    provider_auth_invalid: "API Key 无效或没有模型权限。",
    provider_http_401: "API Key 无效或没有模型权限。",
    provider_http_403: "API Key 无效或没有模型权限。",
    provider_model_not_found: "未找到这个模型，请检查模型名称。",
    hermes_api_unreachable: "无法连接 API 地址，请检查地址和网络。",
    hermes_companion_start_failed: "AI Agent 启动失败。",
    hermes_process_crashed: "AI Agent 启动失败。",
    configuration_desync: "未找到这个模型，请检查模型名称。",
  };
  return descriptions[reason] ?? "配置未应用，请检查 API 地址、模型和 API Key。";
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
