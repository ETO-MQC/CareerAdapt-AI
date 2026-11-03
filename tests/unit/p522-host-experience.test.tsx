import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerExperience } from "../../poc/host-experience/CareerExperience";
import plugin, { EXPERIENCE_ROUTE } from "../../poc/host-experience/plugin";
vi.mock("@hermes/plugin-sdk", () => ({ ROUTES_AREA: "routes", SIDEBAR_NAV_AREA: "sidebar.nav" }));
vi.mock("../../poc/profile-plugin/profile.css", () => ({ default: ".ca-profile-poc{}" }));
vi.mock("../../poc/host-experience/experience.css", () => ({ default: ".ca-experience{}" }));
afterEach(cleanup);
describe("P522 Host experience", () => {
  it("keeps Profile mounted across business placeholders without offering writes", async () => {
    render(<CareerExperience />);
    await screen.findByRole("article");
    fireEvent.change(screen.getByLabelText("查找分类"), { target: { value: "语言" } });
    const nav = screen.getByRole("navigation", { name: "职业工作区" });
    for (const name of ["Jobs", "Applications", "Resume Studio"]) {
      fireEvent.click(within(nav).getByRole("button", { name }));
      expect(screen.getByRole("heading", { name: `${name} 尚未接入` })).toBeVisible();
    }
    fireEvent.click(within(nav).getByRole("button", { name: "Profile" }));
    expect(screen.getByLabelText("查找分类")).toHaveValue("语言");
    expect(within(screen.getByRole("navigation", { name: "资料板块" })).getAllByRole("button")).toHaveLength(1);
  });
  it.each([["empty", "暂无合成资料"], ["error", "合成资料服务暂不可用"], ["invalid", "响应格式无效"], ["loading", "正在加载合成资料"]])("shows %s without stale facts", async (value, text) => {
    render(<CareerExperience />);
    await screen.findByRole("article");
    fireEvent.change(screen.getByLabelText("验证场景"), { target: { value } });
    expect(await screen.findByText(new RegExp(text))).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("registers only public route and sidebar contributions", () => {
    const registerMany = vi.fn(); plugin.register({ registerMany });
    expect(registerMany.mock.calls[0][0].map((c: { area: string }) => c.area)).toEqual(["routes", "sidebar.nav"]);
    expect(registerMany.mock.calls[0][0].every((c: { data: { path: string } }) => c.data.path === EXPERIENCE_ROUTE)).toBe(true);
  });
  it("keeps tokens local and excludes private Host and formal data dependencies", () => {
    const css = readFileSync("poc/host-experience/experience.css", "utf8");
    expect(css).not.toMatch(/:root|(?:^|[},])\s*(?:body|html)\b|--resume-/);
    for (const selector of css.matchAll(/([^{}]+)\{/g)) if (!selector[1].trim().startsWith("@")) expect(selector[1]).toContain(".ca-experience");
    for (const file of ["plugin.tsx", "CareerExperience.tsx", "components.tsx", "pane-probe.tsx"]) expect(readFileSync("poc/host-experience/" + file, "utf8")).not.toMatch(/WorkspaceRepository|indexedDB|localStorage|window\.hermesDesktop|useTheme|requestTheme|ctx\.onDispose|fetch\(/);
  });
});
