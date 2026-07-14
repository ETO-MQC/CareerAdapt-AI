"use client";

import { useState, useEffect } from "react";
import { readDeveloperMode, writeDeveloperMode } from "@/services/preferences/developerMode";
import { readAiSettings, writeAiSettings, clearAiSettings, type AiSettings } from "@/services/storage/aiSettings";

type ThemePreference = "system" | "light" | "dark";
type DensityPreference = "compact" | "comfortable";
type SettingsCategory = "appearance" | "export" | "ai" | "developer" | "help";

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";

const categories: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: "appearance", label: "界面", description: "主题与显示密度" },
  { id: "ai", label: "AI 配置", description: "接口与模型设置" },
  { id: "export", label: "导出", description: "A4 与 PDF 行为" },
  { id: "developer", label: "开发者模式", description: "测试数据清理" },
  { id: "help", label: "帮助", description: "说明入口" }
];

export default function SettingsPage() {
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  const [theme, setTheme] = useState<ThemePreference>(() => typeof window === "undefined" ? "system" : readThemePreference());
  const [density, setDensity] = useState<DensityPreference>(() => typeof window === "undefined" ? "compact" : readDensityPreference());
  const [developerMode, setDeveloperMode] = useState(() => typeof window !== "undefined" && readDeveloperMode());
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => typeof window === "undefined" ? { baseUrl: "", apiKey: "", model: "", provider: "openai-compatible" } : readAiSettings());
  const [aiSaved, setAiSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

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

  return (
    <main className="page-shell settings-workspace">
      <section className="page-title">
        <p className="eyebrow">偏好</p>
        <h1>设置</h1>
        <p>调整应用界面偏好。简历纸张、模板颜色和 PDF 导出不会随应用主题反转。</p>
      </section>

      <section className="settings-layout">
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
              <label className="field-label">
                主题
                <select value={theme} onChange={(event) => updateTheme(event.target.value as ThemePreference)}>
                  <option value="system">跟随系统</option>
                  <option value="light">明亮</option>
                  <option value="dark">暗黑</option>
                </select>
              </label>
              <label className="field-label">
                显示密度
                <select value={density} onChange={(event) => updateDensity(event.target.value as DensityPreference)}>
                  <option value="compact">紧凑</option>
                  <option value="comfortable">舒适</option>
                </select>
              </label>
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
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
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
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
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
