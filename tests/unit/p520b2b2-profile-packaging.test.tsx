import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileHostAdapter } from "../../poc/profile-packaging/ProfileHostAdapter";
import { fakeProfileReadClient, parseProfile } from "../../poc/profile-packaging/client";
import { syntheticProfile } from "../../poc/profile-packaging/fixture";
import plugin, { manifest, PROFILE_ROUTE } from "../../poc/profile-packaging/plugin";

vi.mock("../../poc/profile-plugin/profile.css", () => ({ default: ".ca-profile-poc{color:var(--foreground)}" }));
vi.mock("@hermes/plugin-sdk", () => ({ ROUTES_AREA: "routes", SIDEBAR_NAV_AREA: "sidebar.nav" }));
afterEach(cleanup);

describe("B2-B2 synthetic packaging", () => {
  it("renders all seven required sections without editable facts", async () => {
    render(<ProfileHostAdapter />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载");
    await screen.findByRole("heading", { name: syntheticProfile.name });
    for (const label of ["基础资料", "教育经历", "工作经历", "项目经历", "奖项", "技能", "语言"]) expect(screen.getByRole("region", { name: label })).toBeVisible();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
  it("returns repeatable private fixture copies through one read method", async () => {
    const first = await fakeProfileReadClient.getProfile();
    expect(first).toEqual(syntheticProfile);
    expect(first).not.toBe(syntheticProfile);
    expect(await fakeProfileReadClient.getProfile()).toEqual(first);
    expect(Object.keys(fakeProfileReadClient)).toEqual(["getProfile"]);
  });
  it("distinguishes empty response", async () => {
    render(<ProfileHostAdapter client={{ getProfile: async () => null }} />);
    expect(await screen.findByText("暂无合成资料")).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("preserves service errors", async () => {
    render(<ProfileHostAdapter client={{ getProfile: async () => { throw new Error("synthetic service unavailable"); } }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("synthetic service unavailable");
    expect(screen.queryByRole("article")).toBeNull();
  });
  it.each([undefined, {}, { ...syntheticProfile, name: undefined }, { ...syntheticProfile, basics: [["name"]] }, { ...syntheticProfile, sections: [{ id: "bad", label: "bad", items: [{ title: "missing fields" }] }] }])("rejects invalid or missing fields: %j", async value => {
    expect(() => parseProfile(value)).toThrow("响应格式无效");
    render(<ProfileHostAdapter client={{ getProfile: async () => value }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("响应格式无效");
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("reloads through the client, clears old content while pending", async () => {
    let resolve!: (value: unknown) => void;
    const getProfile = vi.fn().mockResolvedValueOnce(syntheticProfile).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(<ProfileHostAdapter client={{ getProfile }} />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载");
    expect(screen.queryByRole("article")).toBeNull();
    resolve(null);
    await screen.findByText("暂无合成资料");
    expect(getProfile).toHaveBeenCalledTimes(2);
  });
  it("ignores late results after client replacement and unmount", async () => {
    let resolve!: (value: unknown) => void;
    const old = { getProfile: () => new Promise(r => { resolve = r; }) };
    const view = render(<ProfileHostAdapter client={old} />);
    view.rerender(<ProfileHostAdapter />);
    await screen.findByRole("article");
    resolve(null);
    await waitFor(() => expect(screen.getByRole("article")).toBeVisible());
    view.unmount();
    expect(document.querySelectorAll("style[data-careeradapt-profile-poc]")).toHaveLength(0);
  });
  it("uses the locked default object manifest and two public contributions", () => {
    const registerMany = vi.fn(() => () => {});
    plugin.register({ registerMany });
    expect(plugin).toMatchObject(manifest);
    expect(manifest.name).toBe("CareerAdapt Profile");
    const calls = registerMany.mock.calls as unknown as Array<[Array<{ area: string; data: { path: string } }>]>;
    expect(calls[0][0].map(c => c.area)).toEqual(["routes", "sidebar.nav"]);
    expect(calls[0][0].every(c => c.data.path === PROFILE_ROUTE)).toBe(true);
  });
  it("creates no plugin-owned listeners, timers, subscriptions, storage or network capability", () => {
    for (const file of ["client.ts", "fixture.ts", "ProfileHostAdapter.tsx", "plugin.tsx"]) {
      const source = readFileSync("poc/profile-packaging/" + file, "utf8");
      expect(source).not.toMatch(/WorkspaceRepository|CareerAdaptDb|indexedDB|localStorage|fetch\s*\(|ctx\.rest|\.subscribe\s*\(|addEventListener\s*\(|set(?:Timeout|Interval)\s*\(|new\s+(?:MutationObserver|ResizeObserver)|confirmProposal|applyProposal/);
    }
  });
});
