"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

export function DatePicker({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, above: false });
  const now = new Date();
  const matched = /^(\d{4})(?:[-./](\d{1,2}))?/.exec(value);
  const [view, setView] = useState({ year: Number(matched?.[1] ?? now.getFullYear()), month: Number(matched?.[2] ?? now.getMonth() + 1) - 1 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const count = new Date(view.year, view.month + 1, 0).getDate();
  const offset = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
  const monthText = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
  const choose = (date: string) => { onChange(date); setOpen(false); trigger.current?.focus(); };
  function step(delta: number) { const next = new Date(view.year, view.month + delta, 1); setView({ year: next.getFullYear(), month: next.getMonth() }); }
  return <div ref={root} className="date-picker" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" className="date-picker-trigger" aria-label={`选择${label}`} aria-expanded={open} disabled={disabled} onClick={() => {
      if (!open) {
        setView({ year: Number(matched?.[1] ?? now.getFullYear()), month: Math.min(11, Math.max(0, Number(matched?.[2] ?? now.getMonth() + 1) - 1)) });
        const rect = root.current!.getBoundingClientRect();
        const pane = root.current!.closest(".branch-editor")?.getBoundingClientRect() ?? { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
        let clipLeft = pane.left, clipRight = pane.right;
        for (let ancestor = root.current!.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).overflowX !== "visible") {
            const bounds = ancestor.getBoundingClientRect();
            clipLeft = Math.max(clipLeft, bounds.left);
            clipRight = Math.min(clipRight, bounds.right);
          }
        }
        const left = Math.max(clipLeft + 8, Math.min(rect.right - 252, clipRight - 260));
        const below = Math.min(pane.bottom, innerHeight) - rect.bottom;
        setPosition({ left: left - rect.left, above: below < 300 && rect.top - pane.top > below });
      }
      setOpen(!open);
    }}><CalendarDays size={14}/></button>
    {open ? <div className="date-picker-popover" role="dialog" aria-label={`${label}日历`} style={{ left: position.left, right: "auto", ...(position.above ? { top: "auto", bottom: "calc(100% + 5px)" } : {}) }}>
      <div className="date-picker-heading"><button type="button" aria-label="上个月" onClick={() => step(-1)}><ChevronLeft size={15}/></button><label><input type="number" aria-label={`${label}年份`} min={1} max={9999} value={view.year} onChange={event => { const year = event.target.valueAsNumber; if (Number.isInteger(year) && year >= 1 && year <= 9999) setView({ ...view, year }); }}/></label><select aria-label={`${label}月份`} value={view.month} onChange={event => setView({ ...view, month: Number(event.target.value) })}>{Array.from({length:12},(_, month)=><option key={month} value={month}>{month + 1}月</option>)}</select><button type="button" aria-label="下个月" onClick={() => step(1)}><ChevronRight size={15}/></button></div>
      <div className="date-picker-days">{"一二三四五六日".split("").map(day=><small key={day}>{day}</small>)}{Array.from({length:offset},(_, index)=><span key={`blank-${index}`}/>)}{Array.from({length:count},(_, index)=>{const day=index+1;const date=`${monthText}-${String(day).padStart(2,"0")}`;return <button type="button" key={day} aria-label={date} aria-pressed={value === date} onClick={()=>choose(date)}>{day}</button>;})}</div>
      <div className="date-picker-footer"><button type="button" onClick={()=>choose(String(view.year))}>仅年份</button><button type="button" onClick={()=>choose(monthText)}>选取本月</button></div>
    </div> : null}
  </div>;
}
