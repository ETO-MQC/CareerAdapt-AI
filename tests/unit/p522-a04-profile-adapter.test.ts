import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ProfileReadAdapter, type ProfileReadAuthorityContext, type ProfileReadAuthorityProvider } from "@/agent/tools/ProfileReadAdapter";
import { setupRead } from "./p522-a04-fixtures";

/** Test-only issuer. This proves contract behavior, not production identity. */
class SyntheticAuthority implements ProfileReadAuthorityProvider {
  enabled = true;
  epoch = 1;
  sessionId = "session-A";
  profileId = "A";
  workspaceId = "synthetic-workspace";
  leaseExpiry = Date.now() + 60_000;
  verifyCalls = 0;
  grant: ProfileReadAuthorityContext = { workspaceId: this.workspaceId, personId: "person-A", profileId: "A",
    sessionId: "session-A", grantId: "grant-A", epoch: 1, leaseExpiry: this.leaseExpiry,
    requestId: "synthetic-request-1", profileVersionNumber: 1, profileRevision: 1 };
  async context() { return this.grant; }
  async verify(context: ProfileReadAuthorityContext) {
    this.verifyCalls++;
    return this.enabled && context.grantId === this.grant.grantId && context.personId === "person-A"
      && context.epoch === this.epoch && context.sessionId === this.sessionId
      && context.profileId === this.profileId && context.workspaceId === this.workspaceId;
  }
}
async function setup() {
  const fixture = await setupRead();
  const authority = new SyntheticAuthority();
  return { ...fixture, authority, adapter: new ProfileReadAdapter(fixture.service, authority) };
}
describe("A04 D2 existing Gateway narrow read adapter", () => {
  it("calls the actual service/Repository through Gateway and preserves request/source information without writes", async () => {
    const { adapter, authority, db } = await setup();
    const snapshot = () => Promise.all(db.tables.map(async table => [table.name, await table.toArray()]));
    const before = await snapshot();
    for (let i = 0; i < 2; i++) {
      const result = await adapter.execute("career.profile.get", { sectionTypes: ["project"], limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      expect(result.data.profileId).toBe("A"); expect(result.data.requestId).toBe(authority.grant.requestId);
      expect(result.data.items[0].sourceRefs).toContainEqual({ kind: "evidence", id: "evidence-1" });
    }
    expect(authority.verifyCalls).toBeGreaterThanOrEqual(8);
    expect(await snapshot()).toEqual(before);
    const result = await adapter.execute("career.profile.search_facts", { query: "TypeScript", limit: 2 });
    expect(result.ok && result.data.searchSemantics).toBe("keyword_only_no_absence_inference");
  });
  it("fails closed without authority and refuses authority failures", async () => {
    const { service } = await setup();
    expect(await new ProfileReadAdapter(service).execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const broken = { context: async () => { throw new Error("private failure"); }, verify: async () => true };
    expect(await new ProfileReadAdapter(service, broken).execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "SERVICE_UNAVAILABLE" } });
  });
  it.each([
    { profileId: "B" }, { personId: "person-B" }, { sessionId: "B" }, { confirmed: true },
    { epoch: 99 }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { cursor: "malformed" }, { unknown: 1 }
  ])("rejects model authority injection or malformed business arguments %j", async input => {
    const { adapter } = await setup();
    expect(await adapter.execute("career.profile.get", input)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });
  it.each(["lease", "grant", "session", "profile", "disable", "workspace"])("invalidates a retained adapter after %s change", async change => {
    const { adapter, authority } = await setup();
    expect((await adapter.execute("career.profile.get", {})).ok).toBe(true);
    if (change === "lease") authority.grant.leaseExpiry = Date.now() - 1;
    if (change === "grant") authority.epoch++;
    if (change === "session") authority.sessionId = "session-B";
    if (change === "profile") authority.profileId = "B";
    if (change === "disable") authority.enabled = false;
    if (change === "workspace") authority.workspaceId = "other-workspace";
    expect(await adapter.execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "SCOPE_REVOKED" } });
  });
  it("drops results when revoked during a read", async () => {
    const { adapter, service, authority } = await setup();
    const original = service.query.bind(service);
    vi.spyOn(service, "query").mockImplementation(async (...args) => {
      const result = await original(...args); authority.enabled = false; return result;
    });
    expect(await adapter.execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "SCOPE_REVOKED" } });
  });
  it("does not turn missing/legacy/storage errors into successful demo data", async () => {
    const { adapter, db, service } = await setup();
    await db.profiles.update("A", { schemaVersion: undefined });
    expect(await adapter.execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "INITIALIZATION_REQUIRED" } });
    vi.spyOn(service, "query").mockRejectedValue(new Error("storage offline"));
    expect(await adapter.execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "SERVICE_UNAVAILABLE" } });
  });
  it("returns empty and NOT_FOUND without fallback and rejects unsupported tools", async () => {
    const { service } = await setup();
    for (const [id, expected] of [["empty", "empty"], ["missing", "NOT_FOUND"]]) {
      const issuer = new SyntheticAuthority();
      issuer.grant = { ...issuer.grant, profileId: id, personId: `person-${id}` };
      issuer.verify = async () => true; // Explicit test-only grant for this fixture.
      const adapter = new ProfileReadAdapter(service, issuer);
      const result = await adapter.execute("career.profile.get", {});
      if (expected === "empty") expect(result.ok && result.data.status).toBe("empty");
      else expect(result).toMatchObject({ ok: false, error: { code: expected } });
      expect(await adapter.execute("career.profile.capture_intake", {})).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    }
  });
  it("enforces Repository ownership even for a misconfigured synthetic issuer", async () => {
    const { service } = await setup();
    const issuer = new SyntheticAuthority(); issuer.grant.profileId = "B"; issuer.profileId = "B";
    expect(await new ProfileReadAdapter(service, issuer).execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("retains Gateway result ownership checks for the new projection", async () => {
    const { adapter, service, scope } = await setup();
    const result = await service.query(scope, {}, "synthetic-request-1");
    vi.spyOn(service, "query").mockResolvedValue({ ...result, profileId: "B", personId: "person-B" });
    expect(await adapter.execute("career.profile.get", {})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("keeps Adapter independent of Dexie/Repository and leaves the production Host fixture unchanged", () => {
    const source = readFileSync("src/agent/tools/ProfileReadAdapter.ts", "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:storage|dexie)|indexedDB|\.db\./);
    const host = readFileSync("poc/host-experience/profile-read-model.ts", "utf8");
    expect(host).not.toContain("ProfileReadAdapter");
  });
});
