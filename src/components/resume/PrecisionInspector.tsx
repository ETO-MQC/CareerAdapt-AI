"use client";
import { useId, useRef, useEffect, type ReactNode } from "react";
import type { ResumePresentationConfig } from "@/domain/schemas";
import type { PresentationPrecision } from "@/domain/schemas/presentationPrecision";
import { resolvedPrecision } from "./templates/precisionStyles";

type Props = {
  config: ResumePresentationConfig; tab: "font" | "colors" | "page";
  disabled: boolean; supportsPhoto: boolean;
  onPrecisionPreview?(patch: Partial<PresentationPrecision>): void;
  onPrecision(patch: Partial<PresentationPrecision>): void;
  onTypography(patch: Partial<ResumePresentationConfig["typography"]>): void;
  onDensity(value: ResumePresentationConfig["theme"]["density"]): void;
  onMultiPage(value: boolean): void;
  extraPageControls?: ReactNode;
};
const palette = ["#202522", "#485158", "#745827", "#304e7b", "#536d70", "#397550", "#91353e", "#b84963", "#b56b35", "#665475"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number(value.toFixed(3))));

export function NumberControl({ label, value, min, max, step = 1, unit, onChange, disabled = false, compact = false }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; compact?: boolean; onChange(value: number): void;
}) {
  const id = useId();
  return <div className={`precision-number-row ${compact ? "precision-number-compact" : ""}`}>
    <label htmlFor={id}>{label}</label><div className="precision-number-with-unit">
      <div className="precision-stepper">
        <button type="button" aria-label={`减少${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step, min, max))}>−</button>
        <input id={id} aria-label={label} type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} disabled={disabled}
          onChange={e => { if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber)) onChange(clamp(e.target.valueAsNumber, min, max)); }} />
        <button type="button" aria-label={`增加${label}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step, min, max))}>+</button>
      </div>{unit ? <small>{unit}</small> : null}
    </div>
  </div>;
}
function Slider({ label, value, min, max, disabled, onChange, onPreview }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange(value: number): void; onPreview?(value: number): void }) {
  const id = useId();
  const rangeRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rangeRef.current) rangeRef.current.value = String(value);
    if (numberRef.current) numberRef.current.value = String(value);
  }, [value]);
  const commit = () => { if (rangeRef.current && !disabled) onChange(rangeRef.current.valueAsNumber); };
  return <div className="precision-slider"><label htmlFor={id}>{label}</label><div>
    <input ref={rangeRef} id={id} type="range" min={min} max={max} step={1} defaultValue={value} disabled={disabled} aria-label={`${label}滑杆`}
      onInput={event => { const next = event.currentTarget.valueAsNumber; if (numberRef.current) numberRef.current.value = String(next); onPreview?.(next); }}
      onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} />
    <input ref={numberRef} type="number" min={min} max={max} step={1} defaultValue={value} disabled={disabled} aria-label={label} onChange={e => { if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber)) onChange(clamp(e.target.valueAsNumber, min, max)); }} /><small>px</small>
  </div></div>;
}
function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return <div className="precision-switch-row"><span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className="precision-switch" onClick={() => onChange(!checked)}><span /></button></div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) { return <section className="precision-group"><h3>{title}</h3>{children}</section>; }
function Segments<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: Array<[T, string]>; disabled?: boolean; onChange(value: T): void }) {
  return <div className="precision-segment-group"><span>{label}</span><div className="precision-segments" role="group" aria-label={label}>{options.map(([key, text]) => <button key={key} type="button" disabled={disabled} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div></div>;
}
export function PrecisionInspector({ config, tab, disabled, supportsPhoto, onPrecision, onPrecisionPreview, onTypography, onDensity, onMultiPage, extraPageControls }: Props) {
  const p = resolvedPrecision(config);
  const numeric = (key: keyof PresentationPrecision, label: string, min: number, max: number, step: number, unit?: string, compact = false) =>
    <NumberControl key={key} label={label} value={p[key] as number} min={min} max={max} step={step} unit={unit} compact={compact} disabled={disabled} onChange={value => onPrecision({ [key]: value })} />;
  const toggle = (key: keyof PresentationPrecision, label: string) => <Switch label={label} checked={p[key] as boolean} disabled={disabled} onChange={value => onPrecision({ [key]: value })} />;
  if (tab === "font") return <div className="precision-inspector" data-testid="precision-typography">
    <Group title="全局排版">
      {numeric("fontSizePx", "全局字号", 9, 24, 0.2, "px")}
      {numeric("lineHeight", "行间距", 1, 2.4, 0.02, "倍")}
      {numeric("letterSpacingPx", "字间距", -0.5, 3, 0.1, "px")}
      {numeric("sectionGapPx", "板块间距", 0, 40, 1, "px")}
    </Group>
    <Group title="局部字号微调"><div className="precision-local-grid">
      {numeric("nameScale", "姓名", 0.8, 3, 0.05, "倍", true)}
      {numeric("sectionScale", "板块标题", 0.7, 2, 0.02, "倍", true)}
      {numeric("contactScale", "联系方式", 0.6, 1.5, 0.02, "倍", true)}
      {numeric("descriptionScale", "正文描述", 0.7, 1.5, 0.02, "倍", true)}
      {numeric("entryScale", "经历标题", 0.7, 1.6, 0.02, "倍", true)}
      {numeric("targetScale", "求职意向", 0.7, 1.6, 0.02, "倍", true)}
    </div></Group>
    <Group title="排版密度"><Segments label="密度预设" value={config.theme.density} options={[["compact", "紧凑"], ["balanced", "标准"], ["spacious", "宽松"]]} disabled={disabled} onChange={onDensity} /></Group>
  </div>;
  if (tab === "colors") return <div className="precision-inspector" data-testid="precision-style">
    <Group title="字体搭配">
      <label className="precision-select">预设组合<select aria-label="预设组合" disabled={disabled} value={config.typography.englishFont === "times_new_roman" && config.typography.chineseFont === "source_han_serif" ? "serif" : config.typography.englishFont === "arial" && config.typography.chineseFont === "source_han_sans" ? "sans" : "custom"} onChange={e => {
        if (e.target.value === "serif") onTypography({ chineseFont: "source_han_serif", englishFont: "times_new_roman" });
        if (e.target.value === "sans") onTypography({ chineseFont: "source_han_sans", englishFont: "arial" });
      }}><option value="custom">当前字体组合</option><option value="serif">Times New Roman + 思源宋体</option><option value="sans">Arial + 思源黑体</option></select></label>
      <label className="precision-select">英文/数字字体<select aria-label="英文/数字字体" disabled={disabled} value={config.typography.englishFont} onChange={e => onTypography({ englishFont: e.target.value as ResumePresentationConfig["typography"]["englishFont"] })}>
        <option value="system_sans">系统 Sans</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="times_new_roman">Times New Roman</option>
      </select></label>
      <label className="precision-select">中文字体<select aria-label="中文字体" disabled={disabled} value={config.typography.chineseFont} onChange={e => onTypography({ chineseFont: e.target.value as ResumePresentationConfig["typography"]["chineseFont"] })}>
        <option value="system_sans">系统黑体</option><option value="source_han_sans">思源黑体</option><option value="source_han_serif">思源宋体</option>
      </select></label><small className="precision-help">字体缺失时使用本机回退字体，预览与 PDF 使用相同字体栈。</small>
    </Group>
    <Group title="主题色彩">{([["primaryColor", "主色"], ["accentColor", "强调色"], ["dividerColor", "分隔线颜色"]] as const).map(([key, label]) => <div className="precision-color" key={key}><span>{label}</span><div className="precision-palette">{palette.map(color => <button type="button" key={color} disabled={disabled} aria-label={`${label}：${color}`} aria-pressed={p[key].toLowerCase() === color} style={{ background: color }} onClick={() => onPrecision({ [key]: color })} />)}<input type="color" value={p[key]} aria-label={`自定义${label}`} disabled={disabled} onChange={e => onPrecision({ [key]: e.target.value })} /></div></div>)}{toggle("titleFollowColor", "标题跟随主题色")}</Group>
    <Group title="个性化组件样式"><span className="precision-label">板块标题样式</span><div className="precision-preview-grid">{([["plain", "纯文字"], ["underline", "底线"], ["tint", "浅底"]] as const).map(([key, label]) => <button type="button" key={key} disabled={disabled} aria-label={`板块标题样式：${label}`} aria-pressed={p.titleStyle === key} onClick={() => onPrecision({ titleStyle: key })}><span className={`precision-title-sample precision-title-${key}`}>板块标题</span><small>{label}</small></button>)}</div>
      <span className="precision-label">经历条目样式</span><div className="precision-entry-previews">{([["inline", "同行"], ["stacked", "双行"]] as const).map(([key, label]) => <button type="button" key={key} disabled={disabled} aria-label={`经历条目样式：${label}`} aria-pressed={p.entryStyle === key} onClick={() => onPrecision({ entryStyle: key })}><span><b>公司名</b><small>{key === "stacked" ? <br /> : "　"}部门 · 职位</small><time>2024.01</time></span></button>)}</div>
      <label className="precision-select">正文链接样式<select aria-label="正文链接样式" value={p.linkStyle} disabled={disabled} onChange={e => onPrecision({ linkStyle: e.target.value as PresentationPrecision["linkStyle"] })}><option value="plain">示例链接 · 普通文本</option><option value="accent">示例链接 · 强调色</option><option value="underline">示例链接 · 下划线</option></select></label>
    </Group>
    <Group title="符号与线段"><label className="precision-select">列表符号<select aria-label="列表符号" value={p.bulletStyle} disabled={disabled} onChange={e => onPrecision({ bulletStyle: e.target.value as PresentationPrecision["bulletStyle"] })}>{[["disc", "圆点 •"], ["circle", "空心圆 ◦"], ["square", "方块 ▪"], ["dash", "短横线 –"], ["decimal", "数字 1."], ["none", "无符号"]].map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {numeric("bulletScale", "符号大小", 0.5, 2, 0.1, "倍")}{numeric("underlineWidth", "下划线宽度", 0.5, 4, 0.1, "px")}
      {toggle("titleBar", "显示板块标题分隔竖杠")}{toggle("neutralDividers", "分隔线使用中性灰色")}{toggle("contactIcons", "显示个人信息图标")}
    </Group>
  </div>;
  return <div className="precision-inspector" data-testid="precision-page">
    <Group title="页边距（mm）"><div className="precision-local-grid">
      {numeric("marginTopMm", "上边距", 0, 35, 1, "mm", true)}{numeric("marginRightMm", "右边距", 0, 35, 1, "mm", true)}
      {numeric("marginBottomMm", "下边距", 0, 35, 1, "mm", true)}{numeric("marginLeftMm", "左边距", 0, 35, 1, "mm", true)}
    </div><div className="precision-divider" /><Switch label="多页简历模式" checked={config.pagination.pagePolicy !== "one_page_strict"} disabled={disabled} onChange={onMultiPage} /><small className="precision-help">关闭后按单页检查；超出内容会提示并阻止下载，不会删除正文。</small></Group>
    <Group title="抬头与排版">
      <Segments label="头部排版方式" value={p.headerLayout} options={[["left", "左对齐"], ["center", "居中对齐"], ["split", "左右分栏"]]} disabled={disabled} onChange={value => onPrecision({ headerLayout: value })} />
      <Segments label="整体内容上下对齐" value={p.verticalAlign} options={[["top", "顶部"], ["center", "居中"], ["bottom", "底部"]]} disabled={disabled} onChange={value => onPrecision({ verticalAlign: value })} />
      <Slider label="信息左右偏移" value={p.contactOffsetX} min={-24} max={24} disabled={disabled} onPreview={value => onPrecisionPreview?.({ contactOffsetX: value })} onChange={value => onPrecision({ contactOffsetX: value })} />
      <Slider label="信息上下偏移" value={p.contactOffsetY} min={-24} max={24} disabled={disabled} onPreview={value => onPrecisionPreview?.({ contactOffsetY: value })} onChange={value => onPrecision({ contactOffsetY: value })} />
      <Slider label="照片左右偏移" value={0} min={-24} max={24} disabled onChange={() => {}} />
      <Slider label="照片上下偏移" value={0} min={-24} max={24} disabled onChange={() => {}} />
      <small className="precision-help">{supportsPhoto ? "照片位置需由模板的图片布局管理。" : "当前模板不支持照片，照片偏移不可用。"}</small>
      <Slider label="抬头高度" value={p.headerHeightPx} min={0} max={180} disabled={disabled} onPreview={value => onPrecisionPreview?.({ headerHeightPx: value })} onChange={value => onPrecision({ headerHeightPx: value })} />
      <small className="precision-help">0 为自动；高度至少容纳实际内容，避免裁切。</small>
      <Slider label="距正文间距" value={p.headerGapPx} min={0} max={48} disabled={disabled} onPreview={value => onPrecisionPreview?.({ headerGapPx: value })} onChange={value => onPrecision({ headerGapPx: value })} />
    </Group>{extraPageControls ? <details className="precision-advanced"><summary>更多页面设置</summary>{extraPageControls}</details> : null}
  </div>;
}
