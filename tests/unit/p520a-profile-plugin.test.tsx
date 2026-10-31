import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { PluginContext } from "@hermes/plugin-sdk";
import { demoCareerProfile } from "@/data/demoProfile";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { createCareerDomainReadClient } from "../../poc/profile-plugin/read-client";
import { ProfileCareerView } from "../../poc/profile-plugin/ProfileCareerView";

vi.mock("../../poc/profile-plugin/profile.css", () => ({ default: ".ca-profile-poc{color:var(--foreground)}" }));
vi.mock("@hermes/plugin-sdk", () => ({ host: { navigate: vi.fn(), notify: vi.fn() }, ROUTES_AREA: "routes", SIDEBAR_NAV_AREA: "sidebar.nav" }));
afterEach(cleanup);

describe("P520A isolated Profile plugin", () => {
  it("projects formal canonical fields without writing or exposing mutation methods", () => {
    const original = JSON.stringify(demoCareerProfile);
    const client = createCareerDomainReadClient(demoCareerProfile);
    const snapshot = client.readCurrentProfile();
    expect(Object.keys(client)).toEqual(["readCurrentProfile"]);
    expect(snapshot.sections.flatMap(section => section.items).map(item => item.id).sort()).toEqual(canonicalProfileLibraryItems(demoCareerProfile).map(item => item.id).sort());
    expect(Object.isFrozen(snapshot.sections[0].items)).toBe(true);
    expect(JSON.stringify(demoCareerProfile)).toBe(original);
  });
  it("captures a private clone of its source", () => {
    const source = structuredClone(demoCareerProfile);
    const client = createCareerDomainReadClient(source);
    const before = client.readCurrentProfile();
    source.name = "changed outside adapter";
    source.basics.name = "changed outside adapter";
    expect(client.readCurrentProfile()).toEqual(before);
  });
  it("renders canonical Profile content read-only in any React host", () => {
    const profile = createCareerDomainReadClient(demoCareerProfile).readCurrentProfile();
    render(<ProfileCareerView profile={profile} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(profile.name);
    for (const section of profile.sections) expect(screen.getByRole("region", { name: section.label })).toBeVisible();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    for (const section of profile.sections) for (const item of section.items) expect(screen.getAllByText(item.title).length).toBeGreaterThan(0);
  });
  it("registers exactly one full-page route and matching sidebar through public context", async () => {
    const { default: plugin } = await import("../../poc/profile-plugin/plugin");
    const registerMany = vi.fn<PluginContext["registerMany"]>(() => () => {});
    plugin.register({ registerMany });
    const contributions = registerMany.mock.calls[0][0];
    expect(plugin.id).toBe("careeradapt-profile-poc");
    expect(contributions.map((item: { area: string }) => item.area)).toEqual(["routes", "sidebar.nav"]);
    expect((contributions[0].data as { path: string }).path).toBe((contributions[1].data as { path: string }).path);
    expect(contributions[0].render).toBeTypeOf("function");
  });
  it("removes styles on disposal and repeated route reload, without side effects", () => {
    const profile = createCareerDomainReadClient(demoCareerProfile).readCurrentProfile();
    const interval = vi.spyOn(globalThis, "setInterval");
    const observer = vi.spyOn(globalThis, "MutationObserver");
    for (let i = 0; i < 20; i++) {
      const view = render(<ProfileCareerView profile={profile} />);
      expect(document.querySelectorAll("style[data-careeradapt-profile-poc]")).toHaveLength(1);
      view.rerender(<ProfileCareerView profile={profile} />);
      expect(document.querySelectorAll("style[data-careeradapt-profile-poc]")).toHaveLength(1);
      view.unmount();
      expect(document.querySelectorAll("style[data-careeradapt-profile-poc]")).toHaveLength(0);
    }
    expect(interval).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("creates no plugin-owned async resources or persistence access", () => {
    for (const file of ["plugin.tsx", "ProfileCareerView.tsx", "read-client.ts"]) {
      const source = readFileSync("poc/profile-plugin/" + file, "utf8");
      expect(source).not.toMatch(/(?:new\s+(?:WorkspaceRepository|Dexie|MutationObserver)|addEventListener\s*\(|set(?:Interval|Timeout)\s*\(|\.subscribe\s*\(|fetch\s*\()/);
    }
  });
  it("scopes every CSS rule to Career content", () => {
    const css = readFileSync("poc/profile-plugin/profile.css", "utf8");
    for (const rule of css.split("}").filter(s => s.trim())) expect(rule.trim().startsWith(".ca-profile-poc")).toBe(true);
  });
});
