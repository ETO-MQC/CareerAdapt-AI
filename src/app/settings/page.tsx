"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/services/notifications/store";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type {
  DocumentEngineHealth,
  DocumentEngineHealthReport,
  DocumentRecognitionPreferences
} from "@/domain/schemas";
import { runResumeOcrAdapter } from "@/domain/resumeImport/ocrAdapter";
import { readDeveloperMode, writeDeveloperMode } from "@/services/preferences/developerMode";
import {
  readDocumentRecognitionPreferences,
  writeDocumentRecognitionPreferences
} from "@/services/preferences/documentRecognition";
import { readAiSettings, writeAiSettings, clearAiSettings, type AiSettings } from "@/services/storage/aiSettings";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  ProductField,
  ProductSelect,
  ProductTopbar
} from "@/components/ui/product";

type ThemePreference = "system" | "light" | "dark";
type DensityPreference = "compact" | "comfortable";
type SettingsCategory = "appearance" | "document" | "export" | "ai" | "data" | "developer" | "help";

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";

const categories: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: "appearance", label: "界面", description: "主题与显示密度" },
  { id: "document", label: "文档识别", description: "PDF、DOCX 与本地 OCR" },
  { id: "ai", label: "AI 配置", description: "接口与模型设置" },
  { id: "export", label: "导出", description: "A4 与 PDF 行为" },
  { id: "data", label: "数据管理", description: "归档任务与回收站" },
  { id: "developer", label: "开发者模式", description: "测试数据清理" },
  { id: "help", label: "帮助", description: "说明入口" }
];

export default function SettingsPage() {
  const ocrTestInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  const [theme, setTheme] = useState<ThemePreference>(() => typeof window === "undefined" ? "system" : readThemePreference());
  const [density, setDensity] = useState<DensityPreference>(() => typeof window === "undefined" ? "compact" : readDensityPreference());
  const [developerMode, setDeveloperMode] = useState(() => typeof window !== "undefined" && readDeveloperMode());
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => typeof window === "undefined" ? { baseUrl: "", apiKey: "", model: "", provider: "openai-compatible" } : readAiSettings());
  const [aiSaved, setAiSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [documentPreferences, setDocumentPreferences] = useState<DocumentRecognitionPreferences>(() =>
    typeof window === "undefined" ? readDocumentRecognitionPreferences() : readDocumentRecognitionPreferences()
  );
  const [engineHealth, setEngineHealth] = useState<DocumentEngineHealthReport>();
  const [healthChecking, setHealthChecking] = useState(false);
  const [documentFeedback, setDocumentFeedback] = useState("设置会保存在本机浏览器，不保存简历正文、OCR 输出或模型日志。");
  const repositoryRef = useRef(new WorkspaceRepository());
  const [orphanedCounts, setOrphanedCounts] = useState<{ drafts: number; rawInputs: number; pdfSessions: number; orphanedDraftIds: string[]; orphanedRawInputIds: string[]; orphanedPdfSessionIds: string[] } | null>(null);
  const [orphanedLoading, setOrphanedLoading] = useState(false);
  const [orphanedClearing, setOrphanedClearing] = useState(false);
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
                  <p>在仓库外准备 Python 3、PaddleOCR/PaddlePaddle 与 PaddleOCR-VL-1.6 模型目录；通过本机环境变量启动 sidecar，并让 Next.js 仅连接 localhost endpoint。不要提交模型、真实路径或 token。</p>
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
                  <p>配置 AI 模型接口。设置保存在本机浏览器，不会上传到任何服务器。未配置时使用服务端环境变量。</p>
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
                      placeholder="https://api.openai.com/v1"
                    />
                  </label>
                  <label className="field-label">
                    API 密钥
                    <div style={{ position: "relative" }}>
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={aiSettings.apiKey}
                        onChange={(event) => setAiSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="sk-..."
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
                      placeholder="gpt-4o"
                    />
                  </label>
                </>
              ) : null}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    writeAiSettings(aiSettings);
                    setAiSaved(true);
                    setTimeout(() => setAiSaved(false), 2000);
                  }}
                >
                  {aiSaved ? "已保存 ✓" : "保存配置"}
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
