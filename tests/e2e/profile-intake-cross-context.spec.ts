import { expect, test } from "@playwright/test";
import type { ProfileIntakeOperationRequest } from "@/services/storage/repositories";

type Harness = {
  prepare(name: string): Promise<{ base: Omit<ProfileIntakeOperationRequest, "operationId">; frozen: NonNullable<ProfileIntakeOperationRequest["frozen"]> }>;
  prepareAlternative(name: string): Promise<{ base: Omit<ProfileIntakeOperationRequest, "operationId">; frozen: NonNullable<ProfileIntakeOperationRequest["frozen"]> }>;
  commit(name: string, request: ProfileIntakeOperationRequest): Promise<{ ok: boolean; error?: string; result?: { profileVersion: number; idempotent: boolean } }>;
  read(name: string): Promise<{ version: number; itemCount: number }>;
  variant(request: ProfileIntakeOperationRequest): ProfileIntakeOperationRequest;
};
declare global { interface Window { intakeConcurrency: Harness } }

test("separate browser pages serialize Profile intake transactions", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const url = "http://127.0.0.1:5188/profile-intake-concurrency.html";
  await Promise.all([first.goto(url), second.goto(url)]);
  await Promise.all([first.waitForFunction(() => Boolean(window.intakeConcurrency)), second.waitForFunction(() => Boolean(window.intakeConcurrency))]);
  for (const scenario of ["same", "different_fingerprint", "different_operation"] as const) {
    const name = `intake-cross-context-${scenario}-${crypto.randomUUID()}`;
    const prepared = await first.evaluate((db) => window.intakeConcurrency.prepare(db), name);
    const request = { ...prepared.base, operationId: "shared-operation", frozen: prepared.frozen };
    const alternative = scenario === "different_fingerprint"
      ? await second.evaluate((db) => window.intakeConcurrency.prepareAlternative(db), name) : undefined;
    const other = alternative ? { ...alternative.base, frozen: alternative.frozen, operationId: request.operationId }
      : scenario === "different_operation" ? { ...request, operationId: "other-operation" } : request;
    const [left, right] = await Promise.all([
      first.evaluate(({ db, input }) => window.intakeConcurrency.commit(db, input), { db: name, input: request }),
      second.evaluate(({ db, input }) => window.intakeConcurrency.commit(db, input), { db: name, input: other })
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(scenario === "same" ? 2 : 1);
    if (scenario === "same") expect([left.result?.idempotent, right.result?.idempotent].sort()).toEqual([false, true]);
    if (scenario === "different_fingerprint") expect([left, right].find((result) => !result.ok)?.error).toContain("profile_intake_operation_mismatch");
    if (scenario === "different_operation") expect([left, right].find((result) => !result.ok)?.error).toContain("revision_conflict");
    expect(await second.evaluate((db) => window.intakeConcurrency.read(db), name)).toEqual({ version: 2, itemCount: 1 });
  }
});
