"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type FloatingWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
};

const STORAGE_KEY = "careeradapt:floating-window";
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const HEADER_HEIGHT = 0; // 顶部菜单栏高度，防止悬浮窗被遮挡

function loadState(defaults: { x: number; y: number; width: number; height: number }): FloatingWindowState {
  if (typeof window === "undefined") return { ...defaults, minimized: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FloatingWindowState>;
      return {
        x: parsed.x ?? defaults.x,
        y: parsed.y ?? defaults.y,
        width: Math.max(parsed.width ?? defaults.width, MIN_WIDTH),
        height: Math.max(parsed.height ?? defaults.height, MIN_HEIGHT),
        minimized: parsed.minimized ?? false
      };
    }
  } catch { /* ignore */ }
  return { ...defaults, minimized: false };
}

function saveState(state: FloatingWindowState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function FloatingWindow({
  title,
  children,
  defaultX = 100,
  defaultY = 80,
  defaultWidth = 420,
  defaultHeight = 600,
  isOpen,
  onClose,
  onMinimize
}: {
  title: string;
  children: ReactNode;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  isOpen: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
}) {
  const [state, setState] = useState<FloatingWindowState>(() =>
    loadState({ x: defaultX, y: defaultY, width: defaultWidth, height: defaultHeight })
  );
  const windowRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; startPosW: number; startPosH: number; dir: string } | null>(null);
  const preMaximizeState = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      saveState(state);
    }
  }, [state.x, state.y, state.width, state.height, state.minimized, isOpen]);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".floating-window-btn")) return;
    e.preventDefault();
    const startDrag = { startX: e.clientX, startY: e.clientY, startPosX: state.x, startPosY: state.y };
    dragState.current = startDrag;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const d = dragState.current;
      if (!d) return;
      const dx = moveEvent.clientX - d.startX;
      const dy = moveEvent.clientY - d.startY;
      const newY = Math.max(HEADER_HEIGHT, d.startPosY + dy);
      setState((prev) => ({ ...prev, x: d.startPosX + dx, y: newY }));
    };

    const handleUp = () => {
      dragState.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }, [state.x, state.y]);

  const handleResizeStart = useCallback((e: React.PointerEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = {
      startX: e.clientX, startY: e.clientY,
      startPosX: state.x, startPosY: state.y,
      startPosW: state.width, startPosH: state.height,
      dir
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (!resizeState.current) return;
      const dx = moveEvent.clientX - resizeState.current.startX;
      const dy = moveEvent.clientY - resizeState.current.startY;
      const r = resizeState.current;
      let newX = r.startPosX, newY = r.startPosY, newW = r.startPosW, newH = r.startPosH;

      if (dir.includes("e")) newW = clampNumber(r.startPosW + dx, MIN_WIDTH, window.innerWidth - 40);
      if (dir.includes("w")) { newW = clampNumber(r.startPosW - dx, MIN_WIDTH, window.innerWidth - 40); newX = r.startPosX + (r.startPosW - newW); }
      if (dir.includes("s")) newH = clampNumber(r.startPosH + dy, MIN_HEIGHT, window.innerHeight - 40);
      if (dir.includes("n")) { newH = clampNumber(r.startPosH - dy, MIN_HEIGHT, window.innerHeight - 40); newY = Math.max(HEADER_HEIGHT, r.startPosY + (r.startPosH - newH)); }

      setState((prev) => ({ ...prev, x: newX, y: newY, width: newW, height: newH }));
    };

    const handleUp = () => {
      resizeState.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }, [state]);

  const toggleMaximize = useCallback(() => {
    setState((prev) => {
      if (prev.width >= window.innerWidth - 20 && prev.height >= window.innerHeight - 20) {
        // 恢复：使用缓存的原始状态
        const restored = preMaximizeState.current ?? { x: defaultX, y: defaultY, width: defaultWidth, height: defaultHeight };
        preMaximizeState.current = null;
        return { ...prev, ...restored };
      }
      // 最大化：先保存当前状态
      preMaximizeState.current = { x: prev.x, y: prev.y, width: prev.width, height: prev.height };
      return { ...prev, x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    });
  }, [defaultX, defaultY, defaultWidth, defaultHeight]);

  if (!isOpen) return null;

  if (state.minimized) {
    return (
      <button
        type="button"
        className="floating-window-minimized"
        onClick={() => setState((prev) => ({ ...prev, minimized: false }))}
      >
        {title}
      </button>
    );
  }

  return (
    <div
      ref={windowRef}
      className="floating-window"
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height
      }}
    >
      <div className="floating-window-titlebar" onPointerDown={handleDragStart}>
        <span className="floating-window-title">{title}</span>
        <div className="floating-window-btns">
          <button type="button" className="floating-window-btn" onClick={() => setState((prev) => ({ ...prev, minimized: true }))} aria-label="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          </button>
          <button type="button" className="floating-window-btn" onClick={toggleMaximize} aria-label="最大化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.2" fill="none" rx="1" /></svg>
          </button>
          <button type="button" className="floating-window-btn floating-window-close" onClick={onClose} aria-label="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          </button>
        </div>
      </div>
      <div className="floating-window-body">
        {children}
      </div>
      {/* 左下角拖动按钮 - 用于将卡住的窗口拉下来 */}
      <div
        className="floating-window-drag-handle"
        onPointerDown={handleDragStart}
        title="拖动窗口"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M18 11V6a2 2 0 0 0-4 0v1M14 7V4a2 2 0 0 0-4 0v6M10 6V4a2 2 0 0 0-4 0v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M18 11a2 2 0 0 1 2 2v1a8 8 0 0 1-8 8h-1a8 8 0 0 1-5.66-2.34L4 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {/* Resize handles */}
      {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((dir) => (
        <div
          key={dir}
          className={`floating-window-resize floating-window-resize-${dir}`}
          onPointerDown={(e) => handleResizeStart(e, dir)}
        />
      ))}
    </div>
  );
}
