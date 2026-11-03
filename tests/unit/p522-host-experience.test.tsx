import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerExperience } from "../../poc/host-experience/CareerExperience";
import plugin, { EXPERIENCE_ROUTE } from "../../poc/host-experience/plugin";
vi.mock("@hermes/plugin-sdk", () => ({ ROUTES_AREA: "routes", SIDEBAR_NAV_AREA: "sidebar.nav" }));
vi.mock("../../poc/profile-plugin/profile.css", () => ({ default: ".ca-profile-poc{}" }));
vi.mock("../../src/styles/product-components.css", () => ({ default: "" }));
vi.mock("../../src/styles/product-tokens.css", () => ({ default: "" }));
vi.mock("../../poc/host-experience/experience.css", () => ({ default: ".ca-experience{}" }));
afterEach(cleanup);
describe("P522 Host experience", () => {
  it("restores all categories and list/detail selection in the single read-only Profile route", async () => {
    render(<CareerExperience />);
    await screen.findByRole("tab", { name: /基本信息/ });
    expect(screen.getAllByRole("tab")).toHaveLength(19);
    expect(screen.queryByRole("navigation", { name: "职业工作区" })).toBeNull();
    expect(screen.getByRole("region", { name: "当前人物与版本" })).toHaveTextContent("V1");
    fireEvent.click(screen.getByRole("tab", { name: /项目经历/ }));
    const list=screen.getByRole("region", { name: "资料条目" });
    const detail=screen.getByRole("region", { name: "资料详情" });
    fireEvent.click(within(list).getByRole("button", { name: /虚构灯塔信息导航/ }));
    expect(detail).toHaveTextContent("项目背景");
    expect(detail).toHaveTextContent("成果");
    expect(detail).toHaveTextContent("Figma");
    expect(detail).toHaveTextContent("来源证据");
    expect(within(detail).getByRole("button", { name: "编辑" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("搜索资料"), { target: { value: "不存在的搜索" } });
    expect(screen.getByText("当前筛选下没有条目")).toBeVisible();
    expect(detail).not.toHaveTextContent("Figma");
    fireEvent.change(screen.getByLabelText("搜索资料"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("使用状态"), { target: { value: "archived" } });
    expect(detail).toHaveTextContent("虚构归档项目");
    expect(within(detail).getByRole("button", { name: "恢复" })).toBeDisabled();
  });
  it.each([["empty", "暂无合成资料"], ["error", "合成资料服务暂不可用"], ["invalid", "响应格式无效"], ["loading", "正在加载合成资料"]])("shows %s without stale facts", async (value, text) => {
    render(<CareerExperience />);
    await screen.findByRole("tab", { name: /基本信息/ });
    fireEvent.change(screen.getByLabelText("验证场景"), { target: { value } });
    expect(await screen.findByText(new RegExp(text))).toBeVisible();
    expect(screen.queryByRole("region", { name: "资料详情" })).toBeNull();
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
