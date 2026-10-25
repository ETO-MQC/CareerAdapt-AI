"use client";

import { useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { useSidebarEditor } from "./SidebarEditorContext";

export type AccordionItem = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  content: ReactNode;
  actions?: ReactNode;
};

type AccordionListProps = {
  items: AccordionItem[];
  emptyHint?: string;
  addButton?: ReactNode;
  onReorder?: (from: string, to: string) => void;
};

export function AccordionList({ items, emptyHint, addButton, onReorder }: AccordionListProps) {
  const embedded = useSidebarEditor();
  if (items.length === 0) {
    return (
      <div className="accordion-empty">
        {emptyHint ? <p className="accordion-empty-hint">{emptyHint}</p> : null}
        {addButton}
      </div>
    );
  }

  return (
    <div className="accordion-list" data-slot="accordion">
      {!embedded && addButton ? <div className="accordion-add-bar">{addButton}</div> : null}
      {items.map((item, index) => <AccordionItemView key={item.id} item={item} expandedInitially={embedded || Boolean(item.defaultOpen)} onReorder={onReorder} onMove={direction => { const target = items[index + (direction === "up" ? -1 : 1)]; if (target && onReorder) onReorder(item.id, target.id); }} />)}
      {embedded && addButton ? <div className="accordion-add-bar">{addButton}</div> : null}
    </div>
  );
}

function AccordionItemView({ item, expandedInitially, onReorder, onMove }: { item: AccordionItem; expandedInitially: boolean; onReorder?: (from: string, to: string) => void; onMove: (direction: "up" | "down") => void }) {
  const [open, setOpen] = useState(expandedInitially);
  const [dropTarget, setDropTarget] = useState(false);
  return (
    <div className="sidebar-item-card" data-item-drop-target={dropTarget}
      onDragOver={event => { if (onReorder && event.dataTransfer.types.includes("application/careeradapt-item")) { event.preventDefault(); event.stopPropagation(); setDropTarget(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false); }}
      onDrop={event => { const from = event.dataTransfer.getData("application/careeradapt-item"); if (from && onReorder) { event.preventDefault(); event.stopPropagation(); onReorder(from, item.id); } setDropTarget(false); }}>
    {onReorder && item.badge !== "草稿" ? <button type="button" className="sidebar-item-grip sidebar-icon-button" draggable aria-label={`拖动条目：${item.title}`} title="拖动条目，Alt＋上下方向键排序"
      onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData("application/careeradapt-item", item.id); event.dataTransfer.effectAllowed = "move"; }}
      onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); onMove(event.key === "ArrowUp" ? "up" : "down"); } }}><GripVertical size={14}/></button> : null}
    {item.actions}
    <details className="accordion-item" data-content-item-id={item.id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="accordion-item-trigger">
        <span className="accordion-item-title">{item.title}</span>
        {item.subtitle ? <span className="accordion-item-subtitle">{item.subtitle}</span> : null}
        {item.badge ? <span className="accordion-item-badge">{item.badge}</span> : null}
        <span className="accordion-item-chevron" aria-hidden>▾</span>
      </summary>
      <div className="accordion-item-content">{item.content}</div>
    </details>
    </div>
  );
}
