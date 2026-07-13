"use client";

import { type ReactNode } from "react";

type SectionShellProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  saved?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  headerAction?: ReactNode;
};

export function SectionShell({
  icon,
  title,
  description,
  children,
  saved = true,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onPrev,
  onNext,
  hasPrev = true,
  hasNext = true,
  headerAction
}: SectionShellProps) {
  return (
    <div className="section-shell">
      <div className="section-shell-body">
        <div className="section-shell-header">
          <div className="section-shell-icon">{icon}</div>
          <div className="section-shell-header-text">
            <h2 className="section-shell-title">{title}</h2>
            {description ? <p className="section-shell-description">{description}</p> : null}
          </div>
          {headerAction ? <div className="section-shell-header-action">{headerAction}</div> : null}
        </div>
        <div className="section-shell-content">
          {children}
        </div>
      </div>
      <div className="section-shell-footer">
        <div className="section-shell-footer-left">
          <div className="section-shell-undo-redo">
            <button
              type="button"
              className="section-shell-icon-button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="撤销"
              title="撤销"
            >
              ↩
            </button>
            <button
              type="button"
              className="section-shell-icon-button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="重做"
              title="重做"
            >
              ↪
            </button>
          </div>
          <div className={`section-shell-save-badge ${saved ? "section-shell-save-badge-saved" : "section-shell-save-badge-unsaved"}`}>
            {saved ? "✓ 已保存" : "● 未保存"}
          </div>
        </div>
        <div className="section-shell-footer-right">
          <button
            type="button"
            className="section-shell-nav-button"
            disabled={!hasPrev}
            onClick={onPrev}
          >
            ← 返回
          </button>
          <button
            type="button"
            className="section-shell-nav-button section-shell-nav-button-primary"
            disabled={!hasNext}
            onClick={onNext}
          >
            下一步 →
          </button>
        </div>
      </div>
    </div>
  );
}
