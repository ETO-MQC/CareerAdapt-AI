"use client";

import { useCallback, useEffect, useState } from "react";
import type { CareerProfile, JobDescription } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";

export type WorkspaceLoadState =
  | {
      status: "loading";
      profiles: [];
      jobs: [];
      source: "repository";
    }
  | {
      status: "empty";
      profiles: [];
      jobs: [];
      source: "repository";
    }
  | {
      status: "error";
      profiles: [];
      jobs: [];
      source: "repository";
      error: string;
    }
  | {
      status: "ready";
      profiles: CareerProfile[];
      jobs: JobDescription[];
      source: "repository";
    };

const loadingState: WorkspaceLoadState = {
  status: "loading",
  profiles: [],
  jobs: [],
  source: "repository"
};

const defaultRepository = new WorkspaceRepository();

async function readWorkspace(repository: WorkspaceRepository): Promise<WorkspaceLoadState> {
  await repository.ensureDemoWorkspace();

  const [profiles, jobs, activeProfileId] = await Promise.all([
    repository.listProfiles(),
    repository.listJobDescriptions(),
    repository.getActiveProfileId()
  ]);

  if (profiles.length === 0 && jobs.length === 0) {
    return {
      status: "empty",
      profiles: [],
      jobs: [],
      source: "repository"
    };
  }

  const orderedProfiles = activeProfileId
    ? [...profiles].sort((left, right) => Number(right.id === activeProfileId) - Number(left.id === activeProfileId))
    : profiles;

  return {
    status: "ready",
    profiles: orderedProfiles,
    jobs,
    source: "repository"
  };
}

export function useWorkspace(repository: WorkspaceRepository = defaultRepository) {
  const [state, setState] = useState<WorkspaceLoadState>(loadingState);

  useEffect(() => {
    let active = true;

    async function loadInitialWorkspace() {
      try {
        const nextState = await readWorkspace(repository);
        if (active) {
          setState(nextState);
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            profiles: [],
            jobs: [],
            source: "repository",
            error: error instanceof Error ? error.message : "Workspace load failed."
          });
        }
      }
    }

    void loadInitialWorkspace();
    return () => {
      active = false;
    };
  }, [repository]);

  const upsertJob = useCallback((job: JobDescription) => {
    setState((current) => {
      if (current.status !== "ready") {
        return current;
      }
      return {
        ...current,
        jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)]
      };
    });
  }, []);

  const refetch = useCallback(async () => {
    try {
      setState(await readWorkspace(repository));
    } catch {
      // Keep the optimistic local snapshot visible when a background refetch fails.
    }
  }, [repository]);

  return { ...state, upsertJob, refetch };
}
