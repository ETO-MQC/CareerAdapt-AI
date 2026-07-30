"use client";

import { PanelRightOpen, Pin, PinOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentArtifactAction, AgentUiAction } from "@/agent/contracts/agentActions";
import { AgentArtifactContent } from "./AgentArtifactContent";

export type AgentArtifactDrawerState = "closed" | "open" | "pinned" | "collapsed";

export function AgentArtifactDrawer({
  artifacts,
  state,
  workflowState,
  taskState,
  onImportAction,
  onArtifactAction,
  onUiAction,
  onStateChange
}: {
  artifacts: AgentArtifactRef[];
  state: AgentArtifactDrawerState;
  workflowState: TailorWorkflowViewState;
  taskState?: AgentTaskState;
  onImportAction?(message: string): void;
  onArtifactAction?(action: AgentArtifactAction): void;
  onUiAction?(action: AgentUiAction): void;
  onStateChange(state: AgentArtifactDrawerState): void;
}) {
  const [width, setWidth] = useState(432);
  const [selectedArtifactId, setSelectedArtifactId] = useState(() => artifacts[0]?.id);
  const drawerRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const open = state !== "closed" && state !== "collapsed" && artifacts.length > 0;
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0];

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const first = drawer?.querySelector<HTMLElement>("button, a, summary, input, textarea, select");
    const compact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 860px)").matches;
    if (compact) first?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onStateChange("closed");
        return;
      }
      if (event.key !== "Tab" || !compact || !drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>("button, a, summary, input, textarea, select, [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const firstElement = focusable[0];
      const lastElement = focusable.at(-1);
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onStateChange, open]);

  if (state === "closed" || artifacts.length === 0) return null;
  if (state === "collapsed") {
    return (
      <aside className="agent-artifact-drawer is-collapsed" aria-label="已收起的任务产物">
        <button type="button" aria-label={`展开任务产物，共 ${artifacts.length} 项`} onClick={() => onStateChange("open")}>
          <PanelRightOpen aria-hidden="true" />
          <span>{artifacts.length}</span>
        </button>
        <div hidden aria-hidden="true">
          <AgentArtifactContent state={workflowState} taskState={taskState} onImportAction={onImportAction} onArtifactAction={onArtifactAction} onUiAction={onUiAction} />
        </div>
      </aside>
    );
  }

  return (
    <>
      <button
        className="agent-artifact-backdrop"
        type="button"
        aria-label="关闭任务产物"
        onClick={() => onStateChange("closed")}
      />
      <aside
        ref={drawerRef}
        className={state === "pinned" ? "agent-artifact-drawer is-pinned" : "agent-artifact-drawer"}
        aria-label="任务产物"
        style={{ "--agent-artifact-width": `${width}px` } as React.CSSProperties}
      >
        <div
          className="agent-artifact-resizer"
          role="separator"
          aria-label="调整产物面板宽度"
          aria-orientation="vertical"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setWidth((value) => Math.min(480, value + 16));
            if (event.key === "ArrowRight") setWidth((value) => Math.max(400, value - 16));
          }}
          onPointerDown={(event) => {
            const startX = event.clientX;
            const startWidth = width;
            event.currentTarget.setPointerCapture(event.pointerId);
            const handleMove = (moveEvent: PointerEvent) => {
              setWidth(Math.max(400, Math.min(480, startWidth + startX - moveEvent.clientX)));
            };
            const handleUp = () => {
              window.removeEventListener("pointermove", handleMove);
              window.removeEventListener("pointerup", handleUp);
            };
            window.addEventListener("pointermove", handleMove);
            window.addEventListener("pointerup", handleUp);
          }}
        />
        <header className="agent-artifact-drawer-header">
          <div>
            <span>任务产物</span>
            <strong>{selectedArtifact?.title ?? "核对与预览"}</strong>
          </div>
          <button
            type="button"
            aria-label={state === "pinned" ? "取消固定产物面板" : "固定产物面板"}
            onClick={() => onStateChange(state === "pinned" ? "open" : "pinned")}
          >
            {state === "pinned" ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          </button>
          <button type="button" aria-label="收起任务产物" onClick={() => onStateChange("collapsed")}>
            <PanelRightOpen aria-hidden="true" />
          </button>
          <button type="button" aria-label="关闭任务产物" onClick={() => onStateChange("closed")}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="agent-artifact-tabs" role="tablist" aria-label="切换任务产物">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              role="tab"
              aria-selected={artifact.id === selectedArtifact?.id}
              title={artifact.title}
              onClick={() => setSelectedArtifactId(artifact.id)}
            >
              {artifact.title}
            </button>
          ))}
        </div>
        <div className="agent-artifact-drawer-body">
          <AgentArtifactContent state={workflowState} taskState={taskState} onImportAction={onImportAction} onArtifactAction={onArtifactAction} onUiAction={onUiAction} />
          {workflowState.jobGraph || workflowState.fitAnalysis || workflowState.tailoringSession || workflowState.appliedRevisionId || taskState?.knownSlots.importArtifact || taskState?.knownSlots.intakeArtifact ? null : (
            <div className="agent-artifact-partial">
              <strong>{selectedArtifact?.title}</strong>
              <p>{selectedArtifact?.summary ?? "产物已创建，正在等待下一步处理。"}</p>
              {selectedArtifact?.route ? <a href={selectedArtifact.route}>打开原功能页</a> : null}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
