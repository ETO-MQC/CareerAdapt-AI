import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export type SeedPayload = {
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

/**
 * Replays repository-committed rows into the browser database and points the active career
 * context at the seeded profile. The app registers its own context on first run, which would
 * shadow the seeded one, so any other context row is dropped.
 */
export async function installSeed(page: Page, payload: SeedPayload) {
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
        for (const row of seed.rows[name]) tx.objectStore(name).put(row);
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["appMeta"], "readwrite");
      const store = tx.objectStore("appMeta");
      const request = store.getAll();
      request.onsuccess = () => {
        for (const row of request.result as { key: string; value: Record<string, unknown> }[]) {
          const direct = row.value?.profileId;
          const nested = (row.value?.context as Record<string, unknown> | undefined)?.profileId;
          const profileId = (direct as string | undefined) ?? (nested as string | undefined);
          if (profileId !== undefined && profileId !== seed.expectedProfileId) store.delete(row.key);
        }
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, payload);
}

/** Proves the seeded branch is reachable through the active career context. */
export async function readSeedWiring(page: Page, payload: SeedPayload) {
  return page.evaluate(async (expected: SeedPayload) => {
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
    const metaRows = await new Promise<{ key: string; value: Record<string, unknown> }[]>((res, rej) => {
      const tx = db.transaction(["appMeta"], "readonly");
      const request = tx.objectStore("appMeta").getAll();
      request.onsuccess = () => res(request.result as { key: string; value: Record<string, unknown> }[]);
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
}

/** Opens the resume workspace on the seeded branch through the app's own navigation. */
export async function openSeededResume(page: Page, payload: SeedPayload) {
  await page.getByRole("link", { name: "我的简历" }).click();
  await expect(page).toHaveURL(/\/resume/);
  await page.goto(`/resume?branchId=${encodeURIComponent(payload.expectedBranchId)}`);
}