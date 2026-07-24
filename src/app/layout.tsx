import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ModeAwareAppShell } from "@/components/layout/ModeAwareAppShell";
import { WorkspaceModeProvider } from "@/components/layout/WorkspaceModeProvider";
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
  return (
    <html lang="zh-CN">
      <body>
        <WorkspaceModeProvider initialMode={initialMode}>
          <ModeAwareAppShell>{children}</ModeAwareAppShell>
        </WorkspaceModeProvider>
      </body>
    </html>
  );
}
