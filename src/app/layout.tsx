import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ModeAwareAppShell } from "@/components/layout/ModeAwareAppShell";
import { WorkspaceModeProvider } from "@/components/layout/WorkspaceModeProvider";
import { AgentRuntimeProvider } from "@/components/agent/runtime/AgentRuntimeProvider";
import { SetupGuard } from "@/components/layout/SetupGuard";
import {
  parseWorkspaceMode,
  WORKSPACE_MODE_COOKIE_KEY
} from "@/services/preferences/workspaceMode";
import "./globals.css";
import "@/styles/agent-tokens.css";
import "@/styles/agent-shell.css";
import "@/styles/agent-workspace.css";
import "@/styles/agent-artifacts.css";
import "@/styles/product-tokens.css";
import "@/styles/product-shell.css";
import "@/styles/product-components.css";
import "@/styles/product-pages.css";

export const metadata: Metadata = {
  title: "职适AI",
  description: "CareerAdapt AI MVP workspace"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialMode = parseWorkspaceMode(cookieStore.get(WORKSPACE_MODE_COOKIE_KEY)?.value) ?? "ai";
  const themeBootstrap = `(() => {
try {
  const preference = window.localStorage.getItem("careeradapt.theme");
  const density = window.localStorage.getItem("careeradapt.density") === "comfortable" ? "comfortable" : "compact";
  const mode = ${JSON.stringify(initialMode)};
  const resolved = preference === "light" || preference === "dark"
    ? preference
    : mode === "ai"
      ? "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference === "light" || preference === "dark" || preference === "system"
    ? preference
    : mode === "ai" ? "dark" : "system";
  root.dataset.density = density;
  root.style.colorScheme = resolved;
} catch {
  document.documentElement.dataset.theme = ${JSON.stringify(initialMode === "ai" ? "dark" : "light")};
}
})();`;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <SetupGuard>
          <WorkspaceModeProvider initialMode={initialMode}>
            <AgentRuntimeProvider>
              <ModeAwareAppShell>{children}</ModeAwareAppShell>
            </AgentRuntimeProvider>
          </WorkspaceModeProvider>
        </SetupGuard>
      </body>
    </html>
  );
}
