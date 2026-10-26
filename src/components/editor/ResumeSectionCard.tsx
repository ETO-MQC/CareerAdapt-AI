"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Globe, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { AnimatedDragSort } from "./useAnimatedDragSort";
import { SidebarEditorContext } from "./SidebarEditorContext";

type Props = {
  dragSort?: AnimatedDragSort;
  sectionKey: string;
  label: string;
  count: number;
  icon: ReactNode;
  expanded: boolean;
  selected: boolean;
  personal?: boolean;
  visible: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  override?: { showTitle?: boolean; titleOverride?: string };
  children: ReactNode;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onMove: (direction: "up" | "down") => void;
  onDropSection: (key: string) => void;
  onVisibility: () => void;
  onDelete: () => void;
  onStyle: (override?: Props["override"]) => void;
};

export function ResumeSectionCard(props: Props) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [title, setTitle] = useState(props.override?.titleOverride ?? "");
  const personal = props.personal;
  return (
    <section className={`sidebar-section-card${personal ? " sidebar-personal-card" : ""}`} data-section-key={props.sectionKey} data-expanded={props.expanded} data-selected={props.selected} data-dragging={dragging} data-drop-target={dropTarget}
      onDragOver={event => { if (!personal && event.dataTransfer.types.includes("application/careeradapt-section")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false); }}
      onDrop={event => { const key = event.dataTransfer.getData("application/careeradapt-section"); if (!key || personal) return; event.preventDefault(); props.onDropSection(key); setDropTarget(false); }} {...(!personal ? props.dragSort?.itemProps(props.sectionKey) : {})}>
      <div className="sidebar-section-header">
        {!personal ? <button type="button" className="sidebar-icon-button content-drag-handle" draggable aria-label={`拖动排序：${props.label}，Alt加方向键移动`} title="拖动排序，也可按 Alt＋上下方向键"
          onDragStart={event => { event.dataTransfer.setData("application/careeradapt-section", props.sectionKey); event.dataTransfer.effectAllowed = "move"; setDragging(true); }} onDragEnd={() => { setDragging(false); setDropTarget(false); }}
          {...props.dragSort?.handleProps(props.sectionKey)} onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); props.onMove(event.key === "ArrowUp" ? "up" : "down"); } }}><GripVertical size={16} /></button> : null}
        <span className="sidebar-section-icon" aria-hidden="true">{props.icon}</span>
        <button type="button" className="sidebar-section-name" aria-label={props.label} aria-expanded={props.expanded} aria-controls={`sidebar-body-${props.sectionKey}`} aria-current={props.selected ? "page" : undefined} onClick={props.onToggle}>
          <strong>{personal ? "个人信息" : props.label}</strong>
          <small>{personal ? "姓名、联系方式与求职意向" : `${props.count} 个条目${props.count > 0 && !props.visible ? " · 已隐藏" : ""}`}</small>
        </button>
        {!personal ? <div className="sidebar-section-tools">
          <button type="button" className="sidebar-icon-button" aria-label={`上移板块：${props.label}`} disabled={!props.canMoveUp} onClick={() => props.onMove("up")}><ArrowUp size={14}/></button>
          <button type="button" className="sidebar-icon-button" aria-label={`下移板块：${props.label}`} disabled={!props.canMoveDown} onClick={() => props.onMove("down")}><ArrowDown size={14}/></button>
          <button type="button" className="sidebar-icon-button" aria-label={`编辑板块：${props.label}`} onClick={props.onEdit}><Pencil size={14}/></button>
          <button type="button" className="sidebar-icon-button" aria-label={`${props.visible ? "隐藏" : "显示"}板块：${props.label}`} disabled={props.count === 0} onClick={props.onVisibility}>{props.visible ? <Eye size={15}/> : <EyeOff size={15}/>}</button>
          <button type="button" className="sidebar-icon-button" aria-label={`删除板块内容：${props.label}`} onClick={props.onDelete}><Trash2 size={14}/></button>
        </div> : null}
        <button type="button" className="sidebar-icon-button sidebar-expand-button" aria-label={`展开或收起${props.label}`} aria-expanded={props.expanded} aria-controls={`sidebar-body-${props.sectionKey}`} onClick={props.onToggle}>{props.expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button>
      </div>
      <div id={`sidebar-body-${props.sectionKey}`} className="sidebar-section-body" hidden={!props.expanded}>
        {!personal ? <div className="sidebar-local-style">
          <span>本板块独立样式</span>
          <button type="button" className="sidebar-style-trigger" aria-expanded={styleOpen} onClick={() => { setTitle(props.override?.titleOverride ?? ""); setStyleOpen(!styleOpen); }}><Globe size={13}/>{props.override && Object.keys(props.override).length ? "本板块独立设置" : "跟随全局设置"}<ChevronDown size={13}/></button>
          {styleOpen ? <div className="sidebar-style-popover">
            <button type="button" onClick={() => { props.onStyle(undefined); setStyleOpen(false); }}><Globe size={14}/>跟随全局设置</button>
            <label><input type="checkbox" checked={props.override?.showTitle !== false} onChange={event => props.onStyle({ ...props.override, showTitle: event.target.checked })}/>显示板块标题</label>
            <label>独立标题<input aria-label={`${props.label}独立标题`} value={title} maxLength={80} placeholder={props.label} onChange={event => setTitle(event.target.value)}/></label>
            <button type="button" onClick={() => { const next = { ...props.override }; if (title.trim()) next.titleOverride = title.trim(); else delete next.titleOverride; props.onStyle(Object.keys(next).length ? next : undefined); setStyleOpen(false); }}>应用标题设置</button>
          </div> : null}
        </div> : null}
        <SidebarEditorContext.Provider value={true}>{props.children}</SidebarEditorContext.Provider>
      </div>
    </section>
  );
}
