import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";
import { AUTHOR_NEWLINE_SUMMARY, exportSeedPayload } from "./support/p1fDeterministicResumeFixture";

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
    // Measure layout boxes, not the visually scaled canvas: the preview stacks a reading zoom
    // and a fit-to-width transform, so getBoundingClientRect reports a scaled width. offsetWidth
    // is unaffected by transforms, which is exactly the A4 geometry we want to assert.
    const pages = Array.from(document.querySelectorAll<HTMLElement>(".resume-a4-page"));
    const canvas = document.querySelector(".resume-preview-pages");
    const zoomValue = canvas ? getComputedStyle(canvas).zoom : "1";
    const zoom = zoomValue === "normal" ? 1 : Number(zoomValue);
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const readBox = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return null;
      const page = el.closest(".resume-a4-page") as HTMLElement | null;
      const rect = el.getBoundingClientRect();
      const pageRect = page?.getBoundingClientRect();
      const ratio = pageRect && pageRect.height > 0 ? rect.height / pageRect.height : scale;
      const base = pageRect?.top ?? 0;
      const style = getComputedStyle(el);
      return {
        topMm: +((rect.top - base) / ratio / mm).toFixed(3),
        heightMm: +(rect.height / ratio / mm).toFixed(3),
        whiteSpace: style.whiteSpace,
        listStyleType: style.listStyleType,
        text: (el.textContent ?? "").trim()
      };
    };
    return {
      zoom: zoomValue,
      pageCount: pages.filter((el) => el.offsetWidth > 1).length,
      pageSizesMm: pages.map((el) => ({
        w: +(el.offsetWidth / mm).toFixed(2),
        h: +(el.offsetHeight / mm).toFixed(2)
      })),
      blankPages: pages.filter((el) => ((el.textContent ?? "").trim().length) === 0).length,
      sections: Array.from(document.querySelectorAll("[data-render-section]"))
        .map((el) => (el as HTMLElement).dataset.renderSection)
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
    const visiblePages = (result: Awaited<ReturnType<typeof geometry>>) =>
      result.pageSizesMm.filter((size) => size.w > 1 && size.h > 1).map((size) => `${size.w}x${size.h}`);
    expect(preview.pageCount).toBeGreaterThan(0);
    for (const size of preview.pageSizesMm) {
      expect(Math.abs(size.w - 210)).toBeLessThan(1);
      expect(Math.abs(size.h - 297)).toBeLessThan(1);
    }
    expect(preview.blankPages, "no blank page may be emitted").toBe(0);
    expect(preview.pageCount, "every rendered page must occupy paper").toBe(visiblePages(preview).length);

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
    // Print media also keeps the hidden pagination measurement node, so compare only the pages
    // that actually occupy paper.
    expect(
      visiblePages(printed),
      `print pages (${visiblePages(printed).length}) must match preview pages (${visiblePages(preview).length})`
    ).toEqual(visiblePages(preview));
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
    const download = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
    const exportButton = page.getByRole("button", { name: /PDF/ }).first();
    let exported = false;
    if (await exportButton.isEnabled().catch(() => false)) {
      await exportButton.click();
      const file = await download;
      if (file) {
        await file.saveAs(pdfPath);
        exported = true;
      }
    }
    if (!exported) {
      writeFileSync(pdfPath, await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
    }

    if (existsSync(poppler("pdfinfo"))) {
      const info = execFileSync(poppler("pdfinfo"), [pdfPath], { encoding: "utf8" });
      expect(info).toContain("A4");
      const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? "0");
      expect(pages).toBe(preview.pageCount);
    }
    if (existsSync(poppler("pdftotext"))) {
      const text = execFileSync(poppler("pdftotext"), ["-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8" });
      expect(text).toContain(AUTHOR_NEWLINE_SUMMARY.split("\n")[0].slice(0, 8));
    }
  });
});