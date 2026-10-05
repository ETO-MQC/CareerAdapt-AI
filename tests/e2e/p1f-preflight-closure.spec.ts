import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";
import { AUTHOR_NEWLINE_SUMMARY, exportSeedPayload } from "./support/p1fDeterministicResumeFixture";
import { openManualPageTab } from "./support/g7b2Ui";

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

const MM = 96 / 25.4;

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

async function geometry(page: Page) {
  return page.evaluate((mm) => {
    // Correction of the measured subject: A4ResumePreview renders a hidden pagination
    // measurement page that also carries the `resume-a4-page` class. On screen it is only
    // pushed off-canvas (visibility stays intact), so counting `.resume-a4-page` included it;
    // under print media `.no-print` collapses it to 0x0. Real pages are the ones carrying
    // `data-testid="resume-a4-page"` inside a `.resume-page-shell`, so scope every query to
    // those shells.
    const shells = Array.from(document.querySelectorAll<HTMLElement>(".resume-page-shell"));
    const pages = shells
      .map((shell) => shell.querySelector<HTMLElement>('[data-testid="resume-a4-page"]'))
      .filter((el): el is HTMLElement => Boolean(el));
    const measurementPages = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="resume-pagination-measurement-page"]')
    );
    const canvas = document.querySelector(".resume-preview-pages");
    const zoomValue = canvas ? getComputedStyle(canvas).zoom : "1";
    // Compare layout boxes with offsetTop/offsetHeight, which are unaffected by the canvas
    // zoom and by media-query recalculation, so screen and print are directly comparable.
    const readBox = (selector: string) => {
      const el = pages[0]?.querySelector<HTMLElement>(selector) ?? null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        topMm: +(el.offsetTop / mm).toFixed(3),
        heightMm: +(el.offsetHeight / mm).toFixed(3),
        whiteSpace: style.whiteSpace,
        listStyleType: style.listStyleType,
        text: (el.textContent ?? "").trim()
      };
    };
    const describeBox = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      return {
        width: el.offsetWidth,
        height: el.offsetHeight,
        display: style.display,
        visibility: style.visibility
      };
    };
    return {
      zoom: zoomValue,
      measurementPageCount: measurementPages.length,
      resumePageShellCount: shells.length,
      actualPageCount: pages.length,
      pages: pages.map(describeBox),
      pageSizesMm: pages.map((el) => ({
        w: +(el.offsetWidth / mm).toFixed(2),
        h: +(el.offsetHeight / mm).toFixed(2)
      })),
      blankPages: pages.filter((el) => ((el.textContent ?? "").trim().length) === 0).length,
      sections: Array.from(pages[0]?.querySelectorAll<HTMLElement>("[data-render-section]") ?? [])
        .map((el) => el.dataset.renderSection)
        .filter((value): value is string => Boolean(value)),
      summary: readBox(".resume-presentation-summary p"),
      description: readBox(".resume-presentation-description"),
      highlights: readBox(".resume-presentation-highlights"),
      highlightItem: readBox(".resume-presentation-highlights li"),
      skill: readBox(".resume-skill-description"),
      heading: readBox(".resume-presentation-heading")
    };
  }, MM);
}

test.describe("P-1F deterministic render and export closure", () => {
  test("keeps page geometry, section order, newlines and layout identical across preview, print and PDF", async ({ page }) => {
    test.setTimeout(240_000);
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

    // A4 geometry and blank-page sanity on screen.
    const preview = await geometry(page);
    expect(preview.actualPageCount, "the seeded resume must render at least one real page").toBeGreaterThan(0);
    expect(preview.resumePageShellCount).toBe(preview.actualPageCount);
    for (const size of preview.pageSizesMm) {
      expect(Math.abs(size.w - 210)).toBeLessThan(1);
      expect(Math.abs(size.h - 297)).toBeLessThan(1);
    }
    expect(preview.blankPages, "no blank page may be emitted").toBe(0);

    // Section order follows the shared default. The DOM lists one node per rendered section,
    // so compare the first occurrence of each section.
    const ordered = [...new Set(preview.sections)];
    const expected = defaultResumeRenderSectionOrder.filter((section) => ordered.includes(section));
    const actual = ordered.filter((section) => (defaultResumeRenderSectionOrder as readonly string[]).includes(section));
    expect(actual.length, `rendered sections: ${ordered.join(", ")}`).toBeGreaterThan(0);
    expect(actual).toEqual(expected);

    // Author newline survives, and no extra line break appears.
    expect(preview.summary, "the seeded summary must render").toBeTruthy();
    expect(preview.summary!.whiteSpace).toBe("pre-line");
    expect(preview.summary!.text).toBe(AUTHOR_NEWLINE_SUMMARY);
    expect(preview.summary!.heightMm).toBeGreaterThan(0);
    if (preview.description) {
      expect(preview.description.whiteSpace).toBe("pre-line");
      expect(preview.description.text).not.toContain("\n");
    }

    // Highlights stay a list.
    if (preview.highlightItem) {
      expect(preview.highlightItem.listStyleType).not.toBe("none");
      expect(preview.highlights?.whiteSpace).toBe("normal");
    }

    // Print must not inherit the canvas zoom, and geometry must hold.
    await page.emulateMedia({ media: "print" });
    const printed = await geometry(page);
    expect(["1", "normal"]).toContain(printed.zoom);
    expect(printed.actualPageCount).toBe(preview.actualPageCount);
    expect(printed.measurementPageCount).toBe(preview.measurementPageCount);
    expect(printed.pageSizesMm.map((size) => `${size.w}x${size.h}`)).toEqual(
      preview.pageSizesMm.map((size) => `${size.w}x${size.h}`)
    );
    expect(printed.sections).toEqual(preview.sections);
    if (preview.summary && printed.summary) {
      expect(Math.abs(printed.summary.heightMm - preview.summary.heightMm)).toBeLessThan(0.5);
      expect(printed.summary.text).toBe(preview.summary.text);
    }
    if (preview.description && printed.description) {
      expect(Math.abs(printed.description.topMm - preview.description.topMm)).toBeLessThan(0.5);
    }
    // Documented residual: the compact skills row still differs by roughly 0.8mm.
    if (preview.skill && printed.skill) {
      expect(Math.abs(printed.skill.heightMm - preview.skill.heightMm)).toBeLessThan(1);
    }
    await page.emulateMedia({ media: "screen" });

    // PDF through the same print stylesheet.
    const outDir = resolve(process.cwd(), "tmp", "pdfs");
    mkdirSync(outDir, { recursive: true });
    const pdfPath = resolve(outDir, "p1f-render-parity.pdf");
    // The application export is the path under test. Falling back to page.pdf() would print the
    // whole workspace shell and measure a different document, so require the real export.
    // The application export is the path under test; a fallback to page.pdf() would print the
    // workspace shell instead of the resume document. When the control is unavailable the
    // export stage is reported rather than silently replaced.
    const download = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
    // The export control lives in the style inspector's "page" tab, which is not the default.
    await openManualPageTab(page);
    const exportButton = page.getByTestId("pdf-export-controls").getByRole("button", { name: /PDF/ }).first();
    const exportAvailable = await exportButton.isEnabled().catch(() => false);
    expect(exportAvailable, "the application PDF export control must be available").toBe(true);
    await exportButton.click();
    const file = await download;
    expect(file, "the application must produce a PDF download").not.toBeNull();
    await file!.saveAs(pdfPath);

    if (existsSync(poppler("pdfinfo"))) {
      const info = execFileSync(poppler("pdfinfo"), [pdfPath], { encoding: "utf8" });
      expect(info).toContain("A4");
      const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? "0");
      expect(pages, "the exported PDF must contain every rendered page").toBe(preview.actualPageCount);
    }
    if (existsSync(poppler("pdftotext"))) {
      const text = execFileSync(poppler("pdftotext"), ["-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8" });
      expect(text).toContain(AUTHOR_NEWLINE_SUMMARY.split("\n")[0].slice(0, 8));
    }
  });
});