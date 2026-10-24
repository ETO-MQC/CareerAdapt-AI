import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiShell } from "@/components/layout/AiShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/resume" }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={String(href)} {...props}>{children}</a>
}));
vi.mock("@/components/agent/shell/AgentSidebar", () => ({
  ACTIVE_SESSION_KEY: "active-session",
  AgentSidebar: () => <aside />
}));
vi.mock("@/components/agent/context/AgentPageContextProvider", () => ({
  useAgentPageContext: () => ({ updateContext: vi.fn() })
}));
vi.mock("@/services/agent/agentSessionStore", () => ({
  AgentSessionStore: class {
    list() { return Promise.resolve([]); }
  }
}));

describe("AI context bar", () => {
  it("keeps asset content without the retired task context bar", () => {
    render(<AiShell><div>asset</div></AiShell>);
    expect(screen.getByText("asset")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "返回任务" })).toBeNull();
    expect(document.querySelector(".ai-context-bar")).toBeNull();
    expect(screen.queryByText("打开 AI 助手")).toBeNull();
  });
});
