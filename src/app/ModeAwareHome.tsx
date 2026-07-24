"use client";

import { AgentWorkspace } from "@/components/agent/AgentWorkspace";
import { useWorkspaceMode } from "@/components/layout/WorkspaceModeProvider";
import { HomeWorkspace } from "./HomeWorkspace";

export function ModeAwareHome() {
  const { mode } = useWorkspaceMode();
  if (process.env.NEXT_PUBLIC_AI_FIRST_HOME === "false" || mode === "manual") {
    return <HomeWorkspace />;
  }
  return <AgentWorkspace />;
}
