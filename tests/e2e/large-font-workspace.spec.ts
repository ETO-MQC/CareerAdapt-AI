import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { exportSeedPayload } from "./support/p1fDeterministicResumeFixture";

/**
 * Preflight P-1F deterministic closure.
 *
 * The rows are produced by WorkspaceRepository writes (no model provider, no import wizard),
 * then replayed into the browser's IndexedDB. Scope: rendering and export only. The agent
 * conversation path is NOT exercised because the real provider still answers 401, and
 * `sectionOrder` is asserted against the V1 render enum used by the export snapshot.
 */

function poppler(name: "pdftotext" | "pdfinfo") {
  const candidates =
    name === "pdftotext"
      ? [
          "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
        ]
      : [
          "E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe"
        ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return name;
}

type SeedPayload = {
  databaseName: string;
  expectedProfileId: string;
  expectedPersonId: string;
  expectedBranchId: string;
  rows: {
    profiles: Record<string, unknown>[];
    resumeBranches: Record<string, unknown>[];
    resumeRevisions: Record<string, unknown>[];
    appMeta: Record<string, unknown>[];
  };
};

async function installSeed(page: Page, payload: SeedPayload) {
  await page.addInitScript((seed: SeedPayload) => {
    if (sessionStorage.getItem("large-font-seed-installed")) return;
    sessionStorage.setItem("large-font-seed-installed", "yes");
    const open = indexedDB.open(seed.databaseName);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("resumeBranches")) db.createObjectStore("resumeBranches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("resumeRevisions")) db.createObjectStore("resumeRevisions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("appMeta")) db.createObjectStore("appMeta", { keyPath: "key" });
    };
    open.onsuccess = () => {
      const db = open.result;
      const names = Object.keys(seed.rows) as (keyof SeedPayload["rows"])[];
      const tx = db.transaction(names, "readwrite");
      for (const name of names) {
        const store = tx.objectStore(name);
        for (const row of seed.rows[name]) store.put(row);
      }
    };
  }, payload);
}

test.describe("large font and skill layout in workspace", () => {
  test("saves the layout choice and exports an unclipped large-font resume", async ({ page }) => {
    test.setTimeout(90_000);
    const payload = await exportSeedPayload();
    const branchId = payload.expectedBranchId;
    expect(branchId, "the repository seed must produce a branch").toBeTruthy();

    await installSeed(page, payload);
    // Let the app create and migrate its database first, then replay the seed and reload, so the
// Dexie upgrade cannot race the injected rows.
    await page.goto("/setup");
    await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.evaluate(async (seed: SeedPayload) => {
      const open = indexedDB.open(seed.databaseName);
      const db = await new Promise<IDBDatabase>((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const names = Object.keys(seed.rows) as (keyof SeedPayload["rows"])[];
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(names, "readwrite");
        for (const name of names) {
          const store = tx.objectStore(name);
          for (const row of seed.rows[name]) store.put(row);
        }
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      // The app registers its own career context on first run, which would shadow the seeded
      // one. Drop any other context row so the seeded profile stays active.
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["appMeta"], "readwrite");
        const store = tx.objectStore("appMeta");
        const request = store.getAll();
        request.onsuccess = () => {
          for (const row of request.result as { key: string; value: Record<string, unknown> }[]) {
            const carriesProfile =
              typeof row.value?.profileId === "string" ||
              typeof (row.value?.context as Record<string, unknown> | undefined)?.profileId === "string";
            const profileId =
              (row.value?.profileId as string | undefined) ??
              ((row.value?.context as Record<string, unknown> | undefined)?.profileId as string | undefined);
            if (carriesProfile && profileId !== seed.expectedProfileId) store.delete(row.key);
          }
        };
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    }, payload);

    // ResumeWorkspace lists branches by the active career context, so prove the wiring first.
    const wiring = await page.evaluate(async (expected) => {
      const open = indexedDB.open(expected.databaseName);
      const db = await new Promise<IDBDatabase>((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const allBranches = await new Promise<Record<string, unknown>[]>((res, rej) => {
        const tx = db.transaction(["resumeBranches"], "readonly");
        const request = tx.objectStore("resumeBranches").getAll();
        request.onsuccess = () => res(request.result as Record<string, unknown>[]);
        request.onerror = () => rej(request.error);
      });
      const metaRows = await new Promise<{ key: string; value: Record<string, unknown>; updatedAt?: string }[]>((res, rej) => {
        const tx = db.transaction(["appMeta"], "readonly");
        const request = tx.objectStore("appMeta").getAll();
        request.onsuccess = () => res(request.result as { key: string; value: Record<string, unknown>; updatedAt?: string }[]);
        request.onerror = () => rej(request.error);
      });
      const activeRows = metaRows.filter((row) => {
        const direct = row.value?.profileId;
        const nested = (row.value?.context as Record<string, unknown> | undefined)?.profileId;
        return typeof direct === "string" || typeof nested === "string";
      });
      const branch = allBranches.find((row) => row.id === expected.expectedBranchId);
      return {
        activeKeys: activeRows.map((row) => row.key),
        activeProfileIds: activeRows.map((row) => String(row.value?.profileId ?? "")),
        branchProfileId: branch?.profileId as string | undefined,
        branchIds: allBranches.map((row) => row.id as string)
      };
    }, payload);

    expect(
      wiring.activeProfileIds,
      `every active pointer must target the seeded profile; keys: ${wiring.activeKeys.join(", ")}`
    ).toEqual([payload.expectedProfileId, payload.expectedProfileId]);
    expect(wiring.activeProfileIds.length).toBeGreaterThan(0);
    expect(wiring.branchProfileId).toBe(payload.expectedProfileId);
    expect(wiring.branchIds).toContain(payload.expectedBranchId);

    // The app redirects to the profile workspace on a cold start, so navigate through the UI.
    await page.getByRole("link", { name: "我的简历" }).click();
    await expect(page).toHaveURL(/\/resume/);
    await page.goto(`/resume?branchId=${encodeURIComponent(branchId!)}`);
    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 60_000 });

    const panel = page.getByTestId("resume-layout-inspector");
    await panel.getByRole("tab", { name: "排版", exact: true }).click();
    const size = panel.getByLabel("全局字号", { exact: true });
    await size.fill("14.8");
    await size.press("Enter");
    await expect(page.getByTestId("resume-a4-page").first()).toHaveAttribute("style", /--resume-body-font-size: 14.8px/, { timeout: 20000 });
    await panel.getByRole("tab", { name: "样式", exact: true }).click();
    await panel.getByRole("button", { name: "逐条分行", exact: true }).click();
    await expect(page.getByTestId("resume-a4-page").first()).toHaveAttribute("data-precision-skill-layout", "stacked", { timeout: 20000 });
    const storedLayout = () => page.evaluate(async () => {
      const open = indexedDB.open("CareerAdaptDb");
      const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const rows = await new Promise<Array<{ value?: { precision?: { skillLayout?: string } } }>>((resolve, reject) => { const request = db.transaction("appMeta").objectStore("appMeta").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close();
      return rows.find(row => row.value?.precision?.skillLayout)?.value?.precision?.skillLayout;
    });
    await expect.poll(storedLayout, { timeout: 20000 }).toBe("stacked");
    await page.reload();
    await expect(page.getByTestId("resume-a4-page").first()).toHaveAttribute("data-precision-skill-layout", "stacked", { timeout: 60000 });
    await expect(page.getByTestId("resume-a4-page").first()).toHaveAttribute("style", /--resume-body-font-size: 14.8px/);
    await panel.getByRole("tab", { name: "样式", exact: true }).click();
    await panel.getByRole("button", { name: "同行紧凑", exact: true }).click();
    await expect.poll(storedLayout, { timeout: 20000 }).toBe("inline");
    await expect(panel.getByRole("button", { name: "同行紧凑", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".resume-pagination-pending")).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId("resume-a4-page").first()).toHaveAttribute("data-precision-skill-layout", "inline", { timeout: 20000 });
    await expect(async () => { await page.screenshot({ path: ".tmp/large-font-workspace-after.png" }); }).toPass({ timeout: 20000 });
    const clipped = await page.locator('.resume-page-shell [data-testid="resume-a4-page"]').evaluateAll(pages => pages.flatMap(p => { const boundary = p.getBoundingClientRect(); return [...p.querySelectorAll<HTMLElement>('[data-pagination-unit]')].filter(el => { const box = el.getBoundingClientRect(); return box.bottom > boundary.bottom + 2 || box.right > boundary.right + 2; }).map(el => el.textContent); }));
    expect(clipped).toEqual([]);
    const pageCount = await page.locator('.resume-page-shell [data-testid="resume-a4-page"]').count();
    expect(pageCount).toBeGreaterThan(0);
    const download = page.waitForEvent("download", { timeout: 30000 });
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "下载 PDF" }).click();
    const file = await download;
    const pdfPath = resolve(process.cwd(), ".tmp", "large-font-workspace.pdf");
    await file.saveAs(pdfPath);
    const info = execFileSync(poppler("pdfinfo"), [pdfPath], { encoding: "utf8" });
    expect(Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? "0")).toBe(pageCount);
    const text = execFileSync(poppler("pdftotext"), ["-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8" });
    expect(text).toContain("P1F Closure");
  });
});
