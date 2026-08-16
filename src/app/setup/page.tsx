"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { writeAiSettings, hasCustomAiSettings, type AiSettings } from "@/services/storage/aiSettings";
import { requestHermesStart } from "@/services/agent/hermesControl";

export default function SetupPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AiSettings>({
    // The packaged runtime supplies the non-secret provider defaults through
    // its manifest. Leave these empty so entering only the key does not
    // accidentally replace the application's managed Hermes provider.
    baseUrl: "",
    apiKey: "",
    model: "",
    provider: "openai-compatible"
  });
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    // 如果已配置，直接跳转到主页
    if (hasCustomAiSettings()) {
      router.replace("/");
    }
  }, [router]);

  async function handleSave() {
    if (!settings.apiKey.trim()) return;

    setSaving(true);
    writeAiSettings(settings);
    // 先把新配置交给内置 Hermes；即使它暂时不可用，主页仍保留会话入口并显示明确状态。
    await requestHermesStart().catch(() => undefined);
    router.push("/");
  }

  function handleSkip() {
    // 跳过设置，进入 mock 模式
    writeAiSettings({
      ...settings,
      provider: "mock",
      apiKey: "mock-key"
    });
    router.push("/");
  }

  return (
    <div className="setup-page">
      <div className="setup-container">
        <div className="setup-header">
          <div className="setup-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="10" fill="var(--product-accent)" />
              <path d="M12 20L18 14L24 20L18 26L12 20Z" fill="var(--product-accent-ink)" />
              <path d="M20 14L26 20L20 26" fill="var(--product-accent-ink)" fillOpacity="0.6" />
            </svg>
          </div>
          <h1>欢迎使用职适AI</h1>
          <p>配置 AI 接口后即可开始使用</p>
        </div>

        <div className="setup-form">
          <div className="setup-field">
            <label htmlFor="api-key">API 密钥</label>
            <div className="setup-input-wrapper">
              <input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="setup-toggle-visibility"
                onClick={() => setShowApiKey(prev => !prev)}
              >
                {showApiKey ? "隐藏" : "显示"}
              </button>
            </div>
            <p className="setup-hint">内置 Hermes 会在应用启动时接管 AI；密钥只保存在本机。</p>
          </div>

          <div className="setup-field">
            <label htmlFor="base-url">API 地址</label>
            <input
              id="base-url"
              type="text"
              value={settings.baseUrl}
              onChange={(e) => setSettings(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="使用应用内置配置，或填写自定义 OpenAI 兼容地址"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="setup-hint">留空即可使用应用随附的 AI 接口配置。</p>
          </div>

          <div className="setup-field">
            <label htmlFor="model">模型名称</label>
            <input
              id="model"
              type="text"
              value={settings.model}
              onChange={(e) => setSettings(prev => ({ ...prev, model: e.target.value }))}
              placeholder="使用应用内置模型，或填写自定义模型"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="setup-hint">留空即可使用应用随附的模型配置。</p>
          </div>
        </div>

        <div className="setup-actions">
          <button
            type="button"
            className="setup-button setup-button-primary"
            onClick={handleSave}
            disabled={!settings.apiKey.trim() || saving}
          >
            {saving ? "保存中..." : "开始使用"}
          </button>
          <button
            type="button"
            className="setup-button setup-button-secondary"
            onClick={handleSkip}
          >
            跳过，先体验其他功能
          </button>
        </div>

        <div className="setup-footer">
          <p>设置保存在本机浏览器，不会上传到任何服务器</p>
          <p>可随时在「设置 → AI 配置」中修改</p>
        </div>
      </div>

      <style jsx>{`
        .setup-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--product-app-bg);
          padding: var(--product-space-4);
        }

        .setup-container {
          width: 100%;
          max-width: 420px;
          background: var(--product-surface);
          border-radius: var(--product-radius-4);
          padding: var(--product-space-8);
          box-shadow: var(--product-shadow-floating);
        }

        .setup-header {
          text-align: center;
          margin-bottom: var(--product-space-8);
        }

        .setup-logo {
          display: flex;
          justify-content: center;
          margin-bottom: var(--product-space-4);
        }

        .setup-header h1 {
          font: var(--product-font-display);
          color: var(--product-text);
          margin: 0 0 var(--product-space-2);
        }

        .setup-header p {
          font: var(--product-font-body);
          color: var(--product-text-secondary);
          margin: 0;
        }

        .setup-form {
          display: flex;
          flex-direction: column;
          gap: var(--product-space-5);
          margin-bottom: var(--product-space-6);
        }

        .setup-field {
          display: flex;
          flex-direction: column;
          gap: var(--product-space-2);
        }

        .setup-field label {
          font: var(--product-font-label);
          color: var(--product-text);
        }

        .setup-field input {
          width: 100%;
          height: var(--product-control-normal);
          padding: 0 var(--product-space-3);
          font: var(--product-font-body);
          color: var(--product-text);
          background: var(--product-surface-elevated);
          border: 1px solid var(--product-border);
          border-radius: var(--product-radius-2);
          outline: none;
          transition: border-color 160ms ease;
          box-sizing: border-box;
        }

        .setup-field input:focus {
          border-color: var(--product-accent);
        }

        .setup-field input::placeholder {
          color: var(--product-text-secondary);
          opacity: 0.6;
        }

        .setup-input-wrapper {
          position: relative;
        }

        .setup-input-wrapper input {
          padding-right: 4rem;
        }

        .setup-toggle-visibility {
          position: absolute;
          right: var(--product-space-3);
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          font: var(--product-font-caption);
          color: var(--product-text-secondary);
          cursor: pointer;
          padding: 0;
        }

        .setup-toggle-visibility:hover {
          color: var(--product-text);
        }

        .setup-hint {
          font: var(--product-font-caption);
          color: var(--product-text-secondary);
          margin: 0;
        }

        .setup-actions {
          display: flex;
          flex-direction: column;
          gap: var(--product-space-3);
          margin-bottom: var(--product-space-6);
        }

        .setup-button {
          width: 100%;
          height: var(--product-control-prominent);
          font: var(--product-font-body);
          font-weight: 600;
          border-radius: var(--product-radius-2);
          cursor: pointer;
          transition: all 160ms ease;
        }

        .setup-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .setup-button-primary {
          background: var(--product-accent);
          color: var(--product-accent-ink);
          border: none;
        }

        .setup-button-primary:hover:not(:disabled) {
          background: var(--product-accent-hover);
        }

        .setup-button-secondary {
          background: transparent;
          color: var(--product-text-secondary);
          border: 1px solid var(--product-border);
        }

        .setup-button-secondary:hover {
          background: var(--product-surface-subtle);
          color: var(--product-text);
        }

        .setup-footer {
          text-align: center;
          padding-top: var(--product-space-4);
          border-top: 1px solid var(--product-border);
        }

        .setup-footer p {
          font: var(--product-font-caption);
          color: var(--product-text-secondary);
          margin: var(--product-space-1) 0;
        }
      `}</style>
    </div>
  );
}
