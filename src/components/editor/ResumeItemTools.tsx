"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from "lucide-react";

export function ResumeItemTools(props: { title: string; visible: boolean; onMoveUp: () => void; onMoveDown: () => void; onVisibility: () => void; onDelete: () => void }) {
  return <div className="sidebar-item-header-tools">
    <button type="button" className="sidebar-icon-button" aria-label={`上移条目：${props.title}`} onClick={props.onMoveUp}><ArrowUp size={13}/></button>
    <button type="button" className="sidebar-icon-button" aria-label={`下移条目：${props.title}`} onClick={props.onMoveDown}><ArrowDown size={13}/></button>
    <button type="button" className="sidebar-icon-button" aria-label={`${props.visible ? "隐藏" : "显示"}条目：${props.title}`} onClick={props.onVisibility}>{props.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
    <button type="button" className="sidebar-icon-button" aria-label={`删除条目：${props.title}`} onClick={props.onDelete}><Trash2 size={13}/></button>
  </div>;
}
