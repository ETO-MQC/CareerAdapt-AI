"use client";

import { useEffect, useState } from "react";
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

export function useWorkspace(repository: WorkspaceRepository = defaultRepository) {
  const [state, setState] = useState<WorkspaceLoadState>(loadingState);

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      setState(loadingState);

      try {
        await repository.ensureDemoWorkspace();

        const [profiles, jobs] = await Promise.all([
          repository.listProfiles(),
          repository.listJobDescriptions()
        ]);

        if (!active) {
          return;
        }

        if (profiles.length === 0 && jobs.length === 0) {
          setState({
            status: "empty",
            profiles: [],
            jobs: [],
            source: "repository"
          });
          return;
        }

        setState({
          status: "ready",
          profiles,
          jobs,
          source: "repository"
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          status: "error",
          profiles: [],
          jobs: [],
          source: "repository",
          error: error instanceof Error ? error.message : "Workspace load failed."
        });
      }
    }

    void loadWorkspace();

    return () => {
      active = false;
    };
  }, [repository]);

  return state;
}
