import { describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { setupRead, syntheticProfile } from "./p522-a04-fixtures";
async function snapshot(db: CareerAdaptDb) {
  return Promise.all(db.tables.map(async table => ({ name: table.name, rows: await table.toArray() })));
}

describe("A04 D1 pure canonical Profile query", () => {
  it("reads more than 60 projects and more than 60 skills across pages", async () => {
    const { db, service, scope } = await setupRead();
    await db.profiles.put(syntheticProfile("A", 130));
    for (const sectionType of ["project", "skills"] as const) {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.query(scope, { sectionTypes: [sectionType], cursor }, "r");
        ids.push(...page.items.map(item => item.itemId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(ids).toEqual(Array.from({ length: 65 }, (_, index) => `item-${2 * index + (sectionType === "skills" ? 1 : 0)}`));
    }
  });
  it("bounds reference output and never upgrades ungrounded items to confirmed", async () => {
    const { db, service, scope } = await setupRead();
    const profile = syntheticProfile("A", 1);
    profile.structuredFacts![0].factIds = [];
    profile.structuredFacts![0].sourceBlockIds = Array.from({ length: 40 }, (_, i) => `block-${i}`);
    await db.profiles.put(profile);
    const result = await service.query(scope, {}, "r");
    expect(result.items[0].confirmationState).toBe("unknown");
    expect(result.items[0].sourceRefs).toHaveLength(32);
    expect(result.items[0].referencesTruncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(262_144);
  });
  it("pages all 65 items, all projects and skills without silent loss or writes to any store", async () => {
    const { db, repository, service, scope } = await setupRead();
    const before = await snapshot(db);
    const scan = vi.spyOn(db.profiles, "toArray");
    const reads = vi.spyOn(db.profiles, "get");
    const migration = vi.spyOn(repository, "ensureCareerIdentityMigration");
    for (const sectionTypes of [undefined, ["project" as const], ["skills" as const]]) {
      let cursor: string | undefined;
      const ids: string[] = [];
      do {
        const page = await service.query(scope, { sectionTypes, limit: 7, cursor }, "request-1");
        ids.push(...page.items.map(item => item.itemId));
        cursor = page.nextCursor ?? undefined;
        if (cursor) expect(page.truncated).toBe(true);
      } while (cursor);
      expect(new Set(ids).size).toBe(sectionTypes?.[0] === "project" ? 33 : sectionTypes ? 32 : 65);
    }
    expect(migration).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
    expect(reads.mock.calls.every(([id]) => (id as unknown) === "A")).toBe(true);
    scan.mockRestore();
    expect(await snapshot(db)).toEqual(before);
  });
  it("preserves source handles and real confirmation, redacts raw attachment data, marks long text", async () => {
    const { service, scope } = await setupRead();
    const result = await service.query(scope, {}, "request-2");
    expect(result.items[0].textTruncated).toBe(true);
    expect(result.items[0].text).toHaveLength(4000);
    expect(result.items[0].confirmationState).toBe("confirmed");
    expect(result.items[2].confirmationState).toBe("unconfirmed");
    expect(result.items[0].sourceRefs).toContainEqual({ kind: "evidence", id: "evidence-1" });
    expect(result.items[0].sourceRefs).toContainEqual({ kind: "range", id: "block-0", start: 0, end: 5 });
    expect(result.items[2].sourceRefs).toContainEqual({ kind: "ai_proposal", id: "turn-2" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|secret.pdf|filePath/);
  });
  it("distinguishes empty, missing, legacy and absent Person initialization without repair", async () => {
    const { db, service, scope } = await setupRead();
    await db.profiles.put({ ...syntheticProfile("legacy"), schemaVersion: undefined, personId: undefined });
    await db.profiles.put(syntheticProfile("uninitialized"));
    const before = await snapshot(db);
    expect((await service.query({ ...scope, profileId: "empty", personId: "person-empty" }, {}, "r")).status).toBe("empty");
    for (const [id, code] of [["missing", "NOT_FOUND"], ["legacy", "INITIALIZATION_REQUIRED"], ["uninitialized", "INITIALIZATION_REQUIRED"]]) {
      await expect(service.query({ ...scope, profileId: id, personId: `person-${id}` }, {}, "r")).rejects.toMatchObject({ code });
    }
    expect(await snapshot(db)).toEqual(before);
  });
  it("rejects wrong owner, malformed/cross-scope/range/stale cursors and invalid limits", async () => {
    const { db, service, scope } = await setupRead();
    const cursor = (await service.query(scope, { limit: 2 }, "r")).nextCursor!;
    await expect(service.query({ ...scope, profileId: "B" }, {}, "r")).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const input of [{ cursor: "bad" }, { limit: 0 }, { limit: 21 }, { profileId: "B" }, { limit: 2, cursor, sectionTypes: ["skills"] }]) {
      await expect(service.query(scope, input, "r")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(service.query({ ...scope, profileId: "B", personId: "person-B" }, { limit: 2, cursor }, "r")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await db.profiles.update("A", { version: 2 });
    await expect(service.query(scope, { limit: 2, cursor }, "r")).rejects.toMatchObject({ code: "STALE_CURSOR" });
  });
  it("keeps search lexical and distinguishes a missed keyword from absence of skills", async () => {
    const { service, scope } = await setupRead();
    const missed = await service.query(scope, { query: "no-match" }, "r", true);
    expect(missed.items).toEqual([]); expect(missed.searchSemantics).toBe("keyword_only_no_absence_inference");
    expect((await service.query(scope, { sectionTypes: ["skills"] }, "r")).items.length).toBe(20);
  });
});
