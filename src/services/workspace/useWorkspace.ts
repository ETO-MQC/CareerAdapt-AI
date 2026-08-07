"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActiveCareerContext, CareerProfile, JobDescription } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { useCareerContextStore } from "@/services/career/CareerContextStore";

export type WorkspaceLoadState =
  | { status: "loading"; profiles: []; jobs: []; activeContext?: ActiveCareerContext; source: "repository" }
  | { status: "empty"; profiles: []; jobs: []; activeContext?: ActiveCareerContext; source: "repository" }
  | { status: "error"; profiles: []; jobs: []; activeContext?: ActiveCareerContext; source: "repository"; error: string }
  | { status: "ready"; profiles: CareerProfile[]; jobs: JobDescription[]; activeContext?: ActiveCareerContext; source: "repository" };

const defaultRepository = new WorkspaceRepository();

export function useWorkspace(repository: WorkspaceRepository = defaultRepository) {
  const career = useCareerContextStore();
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string>();

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      await repository.ensureDemoWorkspace();
      setJobs(await repository.listJobDescriptions());
      setJobsError(undefined);
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : "Workspace load failed.");
    } finally {
      setJobsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadJobs(); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadJobs]);

  const profiles = useMemo(() => {
    if (!career.activeContext) return career.profiles;
    return [...career.profiles].sort((left, right) => Number(right.id === career.activeContext?.profileId) - Number(left.id === career.activeContext?.profileId));
  }, [career.activeContext, career.profiles]);

  const state: WorkspaceLoadState = career.error || jobsError
    ? { status: "error", profiles: [], jobs: [], activeContext: career.activeContext, source: "repository", error: career.error ?? jobsError ?? "Workspace load failed." }
    : career.loading || jobsLoading
      ? { status: "loading", profiles: [], jobs: [], activeContext: career.activeContext, source: "repository" }
      : profiles.length === 0 && jobs.length === 0
        ? { status: "empty", profiles: [], jobs: [], activeContext: career.activeContext, source: "repository" }
        : { status: "ready", profiles, jobs, activeContext: career.activeContext, source: "repository" };

  const upsertJob = useCallback((job: JobDescription) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
  }, []);

  const refreshCareer = career.refresh;
  const refetch = useCallback(async () => {
    await Promise.all([refreshCareer(), loadJobs()]);
  }, [refreshCareer, loadJobs]);

  return { ...state, upsertJob, refetch };
}
