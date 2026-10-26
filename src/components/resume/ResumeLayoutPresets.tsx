"use client";
import { useEffect, useState } from "react";
import { layoutStyleFrom, referenceLayoutStyle, type ResumeLayoutPreset, type ResumeLayoutStyle } from "@/domain/resumePresentation/layoutPresets";
import type { ResumePresentationConfig } from "@/domain/schemas";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export function ResumeLayoutPresets({ repository, config, disabled, onApply }: { repository: WorkspaceRepository; config: ResumePresentationConfig; disabled: boolean; onApply(style: ResumeLayoutStyle): void }) {
  const [presets, setPresets] = useState<ResumeLayoutPreset[]>([]);
  const [selected, setSelected] = useState("reference");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; repository.getResumeLayoutPresets().then(items => { if (active) setPresets(items); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [repository]);
  async function save() {
    setBusy(true); setError("");
    try { const preset = await repository.saveResumeLayoutPreset(name, layoutStyleFrom(config)); setPresets(previous => [...previous, preset]); setSelected(preset.id); setName(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "排版预设保存失败。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await repository.deleteResumeLayoutPreset(selected); setPresets(previous => previous.filter(preset => preset.id !== selected)); setSelected("reference"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "预设删除失败。"); }
    finally { setBusy(false); }
  }
  return <section className="resume-layout-presets"><h3>排版预设</h3><small>保存字号、间距、边距、字体和配色，可用于其他简历。</small>
    <label className="precision-select">选择排版预设<select aria-label="选择排版预设" value={selected} disabled={disabled || busy} onChange={event => setSelected(event.target.value)}><option value="reference">参考排版 · 15px / 行距1.56</option>{presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
    <div className="action-row"><button type="button" className="section-action-button" disabled={disabled || busy} onClick={() => { const style = selected === "reference" ? referenceLayoutStyle(config) : presets.find(preset => preset.id === selected)?.style; if (style) onApply(style); }}>应用排版预设</button>{selected !== "reference" ? <button type="button" className="section-action-button" disabled={disabled || busy} onClick={() => void remove()}>删除此预设</button> : null}</div>
    <input className="field-input" aria-label="新排版预设名称" placeholder="为当前排版命名" maxLength={60} value={name} disabled={disabled || busy} onChange={event => setName(event.target.value)} />
    <button type="button" className="section-action-button" disabled={disabled || busy || !name.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存当前排版"}</button>
    {error ? <p role="alert" className="field-error">{error}</p> : null}
  </section>;
}
