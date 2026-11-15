import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { jd02Fixture } from "../fixtures/jd02";
import { JobsWorkspace } from "@/app/jobs/JobsWorkspace";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import type { RequirementMatch } from "@/domain/schemas";
const hooks = vi.hoisted(() => ({ workspace: {}, push: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }));
vi.mock("@/services/workspace/useWorkspace", () => ({ useWorkspace: () => hooks.workspace }));
vi.mock("@/services/jobs/tailoringService", async original => ({ ...await original<object>(), createJobResume: hooks.create }));
const f = jd02Fixture();
f.profile.personId = "jd02-person";
beforeEach(() => {
  window.history.replaceState({}, "", "/jobs?jobId=jd02-job-1&sourceMode=resume&resumeId=jd02-branch-1");
  hooks.workspace = { status: "ready", profiles: [f.profile], jobs: f.jobs, activeContext: { profileId: f.profile.id }, upsertJob: vi.fn() };
  vi.spyOn(WorkspaceRepository.prototype, "getLatestActiveJobAnalysisDraft").mockResolvedValue(undefined);
  vi.spyOn(WorkspaceRepository.prototype, "getMeta").mockResolvedValue(undefined);
  vi.spyOn(WorkspaceRepository.prototype, "getRecycleBinState").mockResolvedValue({ version: 1, jobIds: [], profileItems: [] });
  vi.spyOn(WorkspaceRepository.prototype, "listResumeBranches").mockResolvedValue(f.branches.map(row => migrateResumeBranchToV2(row.branch)));
  vi.spyOn(WorkspaceRepository.prototype, "listAvailableResumesForCareerProfile").mockResolvedValue(f.branches.map(row => ({
    branch: migrateResumeBranchToV2(row.branch), compatibility: { status: "compatible", invalidFactRefs: [] }
  })));
  hooks.push.mockClear(); hooks.create.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("ignores a delayed stored result after switching jobs", async () => {
  let finish!: (matches: RequirementMatch[]) => void;
  const deferred = new Promise<RequirementMatch[]>(resolve => { finish = resolve; });
  vi.spyOn(WorkspaceRepository.prototype, "listRequirementMatches").mockImplementation(async (_profile, job) => job === f.jobs[0].id ? deferred : []);
  render(createElement(JobsWorkspace));
  await waitFor(() => expect(screen.getByLabelText("来源通用简历")).toHaveValue("jd02-branch-1"));
  fireEvent.click(screen.getByText("JD02 岗位 2", { selector: "strong" }));
  await act(async () => { finish(createRuleRequirementMatches({ profile: f.profile, job: f.jobs[0] }).map(match => ({ ...match, matcherVersion: "obsolete", sourceResumeBranchId: f.branches[0].branch.id }))); });
  fireEvent.click(screen.getByRole("tab", { name: "岗位要求" }));
  expect(screen.queryByText(/历史匹配已过期/)).not.toBeInTheDocument();
  expect(screen.getByText(/熟悉 Java 和 Spring Boot/, { selector: "strong" })).toBeInTheDocument();
});
it("ignores a delayed analysis save after switching resumes and never generates a branch", async () => {
  vi.spyOn(WorkspaceRepository.prototype, "listRequirementMatches").mockResolvedValue([]);
  let finish!: (matches: RequirementMatch[]) => void;
  const deferred = new Promise<RequirementMatch[]>(resolve => { finish = resolve; });
  const save = vi.spyOn(WorkspaceRepository.prototype, "saveRuleRequirementMatches").mockReturnValue(deferred);
  render(createElement(JobsWorkspace));
  await waitFor(() => expect(screen.getByLabelText("来源通用简历")).toHaveValue("jd02-branch-1"));
  fireEvent.click(screen.getByTestId("analyze-and-generate-job-resume"));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("来源通用简历"), { target: { value: "jd02-branch-2" } });
  await act(async () => { finish(save.mock.calls[0][0].matches); });
  expect(hooks.create).not.toHaveBeenCalled(); expect(hooks.push).not.toHaveBeenCalled();
  expect(screen.getByLabelText("来源通用简历")).toHaveValue("jd02-branch-2");
});
it("offers a compatible older version from the same person without offering another person's resume", async () => {
  const current = { ...f.profile, id: "current-profile", personId: "jd02-person" };
  const foreign = { ...f.profile, id: "foreign-profile", personId: "other-person" };
  const foreignBranch = { ...f.branches[1].branch, id: "foreign-branch", profileId: foreign.id };
  hooks.workspace = { status: "ready", profiles: [current, f.profile, foreign], jobs: f.jobs,
    activeContext: { profileId: current.id }, upsertJob: vi.fn() };
  vi.mocked(WorkspaceRepository.prototype.listAvailableResumesForCareerProfile).mockResolvedValue([
    { branch: migrateResumeBranchToV2(f.branches[0].branch), compatibility: { status: "profile_updated", invalidFactRefs: [] } },
    { branch: migrateResumeBranchToV2(foreignBranch), compatibility: { status: "profile_updated", invalidFactRefs: [] } }
  ]);
  vi.spyOn(WorkspaceRepository.prototype, "listRequirementMatches").mockResolvedValue([]);
  render(createElement(JobsWorkspace));
  await waitFor(() => expect(screen.getByLabelText("来源通用简历")).toHaveValue("jd02-branch-1"));
  const select = screen.getByLabelText("来源通用简历");
  expect(select.querySelector('option[value="foreign-branch"]')).toBeNull();
  expect(select.querySelector('option[value="jd02-branch-1"]')).not.toBeNull();
});
