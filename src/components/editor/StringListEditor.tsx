"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useAnimatedDragSort } from "./useAnimatedDragSort";
import { FieldFormatting } from "./FieldFormatting";

export function StringListEditor({ values, onChange, field, label, idPrefix, onFocus }: { values: string[]; onChange: (values: string[]) => void; field: string; label: string; idPrefix: string; onFocus?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const sort = useAnimatedDragSort(values.map((_, index) => String(index)), `application/careeradapt-line-${idPrefix.toLowerCase()}`, order => onChange(order.map(id => values[Number(id)])));
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= values.length || to >= values.length) return;
    const next = [...values]; const [value] = next.splice(from, 1); next.splice(to, 0, value); onChange(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>(`[data-line-index="${to}"] textarea`)?.focus());
  }
  return <div ref={node => { root.current = node; sort.rootRef(node); }} {...sort.rootProps} className="string-list-editor" aria-label={`${label}逐条编辑`}>
    <div className="string-list-heading"><span className="field-input-label">{label}</span>{field === "honors" ? <div><button type="button" className="section-action-button" disabled={values.length < 2} onClick={() => onChange([values.join("；")])}>合并为一段</button><button type="button" className="section-action-button" disabled={!values.some(value => /[；;\n]/.test(value))} onClick={() => onChange(values.flatMap(value => value.split(/[；;\n]+/).map(part => part.trim()).filter(Boolean)))}>拆分为多条</button></div> : null}</div>
    {values.map((value, index) => <div key={index} className="string-list-row" data-line-index={index} {...sort.itemProps(String(index))}>
      <div className="string-list-handle-group"><button type="button" className="sidebar-icon-button string-list-grip" aria-label={`拖动${label}第${index + 1}条`} title="拖拽或 Alt＋上下方向键排序"
        {...sort.handleProps(String(index))} onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(index, index + (event.key === "ArrowUp" ? -1 : 1)); } }}><GripVertical size={14}/></button>
        <button type="button" className="sidebar-icon-button string-list-step" aria-label={`上移${label}第${index + 1}条`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={11}/></button>
        <button type="button" className="sidebar-icon-button string-list-step" aria-label={`下移${label}第${index + 1}条`} disabled={index === values.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={11}/></button>
      </div>
      <FieldFormatting field={field} value={value} occurrence={values.slice(0, index).filter(previous => previous === value).length} label={`${label}第${index + 1}条`} onDelete={() => onChange(values.filter((_, at) => at !== index))} onAdd={() => { const next = [...values]; next.splice(index + 1, 0, ""); onChange(next); requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>(`[data-line-index="${index + 1}"] textarea`)?.focus()); }}>
        <AutoTextarea id={`${idPrefix}-${index}`} label={`${label}第${index + 1}条`} value={value} onFocus={onFocus} onChange={text => onChange(values.map((previous, at) => at === index ? text : previous))}/>
      </FieldFormatting>
    </div>)}
    <button type="button" className="sidebar-add-entry string-list-add" onClick={() => { onChange([...values, ""]); requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>(`[data-line-index="${values.length}"] textarea`)?.focus()); }}>＋ 添加{label}</button>
  </div>;
}

export function AutoTextarea({ id, label, value, onChange, onFocus }: { id: string; label: string; value: string; onChange: (value: string) => void; onFocus?: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth > 0) { node.style.height = "0px"; node.style.height = `${Math.max(44, node.scrollHeight)}px`; } };
    measure();
    let previousWidth = node.clientWidth;
    const observer = new ResizeObserver(() => { if (node.clientWidth !== previousWidth) { previousWidth = node.clientWidth; measure(); } });
    observer.observe(node);
    const appearance = new MutationObserver(measure);
    const surface = node.closest(".field-format-surface");
    if (surface) appearance.observe(surface, { attributes: true, attributeFilter: ["style"] });
    return () => { observer.disconnect(); appearance.disconnect(); };
  }, [value]);
  return <textarea ref={input} id={id} aria-label={label} className="field-input auto-textarea" value={value} rows={2} onChange={event => onChange(event.target.value)} onFocus={onFocus}/>;
}
