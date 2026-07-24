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
  it("has one task link instead of duplicate AI workspace links", () => {
    render(<AiShell><div>asset</div></AiShell>);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/ai-workspace");
    expect(screen.queryByText("打开 AI 助手")).toBeNull();
  });
});
