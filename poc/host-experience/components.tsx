import { useId, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ProductButton as Button, ProductDialog, ProductSurface, ProductTabs } from "../../src/components/ui/product";

export function CareerTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}
export function CareerCard({ title, children }: { title: string; children: ReactNode }) {
  return <ProductSurface><header className="ca-section-header"><h2>{title}</h2></header>{children}</ProductSurface>;
}
export function CareerTabs({ labels, value, onChange }: { labels: string[]; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return <ProductTabs aria-label="组件规范分类">{labels.map((label, i) => <Button key={label} id={`${id}-${i}`} role="tab" aria-selected={value === label} tabIndex={value === label ? 0 : -1} onClick={() => onChange(label)} onKeyDown={e => {
    const next = e.key === "Home" ? 0 : e.key === "End" ? labels.length - 1 : e.key === "ArrowRight" ? (i + 1) % labels.length : e.key === "ArrowLeft" ? (i + labels.length - 1) % labels.length : -1;
    if (next >= 0) { e.preventDefault(); onChange(labels[next]); e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
  }}>{label}</Button>)}</ProductTabs>;
}
/** Uses native modal focus trapping; owns only descendants of the Career root. */
export function CareerSpecDialog({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <div ref={wrapper}>
    <Button onClick={e => { opener.current = e.currentTarget; wrapper.current?.querySelector("dialog")?.showModal(); }}>组件规范</Button>
    <ProductDialog aria-labelledby={id} onClose={() => opener.current?.focus()}><header className="ca-section-header"><h2 id={id}>CareerAdapt 组件规范</h2><Button onClick={() => wrapper.current?.querySelector("dialog")?.close()}>关闭</Button></header>{children}</ProductDialog>
  </div>;
}
