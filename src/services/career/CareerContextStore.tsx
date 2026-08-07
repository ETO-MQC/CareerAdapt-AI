"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { ActiveCareerContext, CareerPerson, CareerProfile } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";

export type CareerContextStoreSnapshot = {
  persons: CareerPerson[];
  profiles: CareerProfile[];
  activeContext?: ActiveCareerContext;
  selectedPersonId?: string;
  selectedProfileId?: string;
  loading: boolean;
  error?: string;
};

const initialSnapshot: CareerContextStoreSnapshot = {
  persons: [],
  profiles: [],
  loading: true
};

export class CareerContextStore {
  private snapshot: CareerContextStoreSnapshot = initialSnapshot;
  private readonly listeners = new Set<() => void>();
  private refreshPromise?: Promise<void>;
  private readonly repository: WorkspaceRepository;

  constructor(repository = new WorkspaceRepository()) {
    this.repository = repository;
  }

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initialSnapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setSnapshot(next: CareerContextStoreSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        await this.repository.ensureDemoWorkspace();
        const [persons, profiles, activeContext] = await Promise.all([
          this.repository.listCareerPersons(),
          this.repository.listProfiles(),
          this.repository.getActiveCareerContext()
        ]);
        const selectedPersonId = this.snapshot.selectedPersonId && persons.some((person) => person.id === this.snapshot.selectedPersonId)
          ? this.snapshot.selectedPersonId
          : activeContext?.personId ?? persons[0]?.id;
        const selectedProfileId = this.snapshot.selectedProfileId && profiles.some((profile) => profile.id === this.snapshot.selectedProfileId)
          ? this.snapshot.selectedProfileId
          : activeContext?.profileId ?? profiles.find((profile) => profile.personId === selectedPersonId)?.id;
        this.setSnapshot({
          persons,
          profiles,
          activeContext,
          selectedPersonId,
          selectedProfileId,
          loading: false,
          error: undefined
        });
      } catch (error) {
        this.setSnapshot({
          ...this.snapshot,
          loading: false,
          error: error instanceof Error ? error.message : "人物与版本加载失败。"
        });
      } finally {
        this.refreshPromise = undefined;
      }
    })();
    return this.refreshPromise;
  }

  selectManagerItem(personId?: string, profileId?: string) {
    this.setSnapshot({ ...this.snapshot, selectedPersonId: personId, selectedProfileId: profileId });
  }

  async selectContext(input: Pick<ActiveCareerContext, "personId" | "profileId">) {
    const activeContext = await this.repository.setActiveCareerContext(input);
    this.setSnapshot({ ...this.snapshot, activeContext, selectedPersonId: activeContext.personId, selectedProfileId: activeContext.profileId, error: undefined });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change", { detail: activeContext }));
    }
    await this.refresh();
    return activeContext;
  }

  async createPerson(displayName: string) {
    const previousContext = await this.repository.getActiveCareerContext();
    const result = await this.repository.createPerson(displayName);
    if (previousContext && previousContext.profileId !== result.profile.id) {
      await this.repository.setActiveCareerContext(previousContext);
    }
    await this.refresh();
    this.selectManagerItem(result.person.id, result.profile.id);
    return result;
  }

  async createVersion(profileId: string) {
    const previousContext = await this.repository.getActiveCareerContext();
    const profile = await this.repository.createProfileVersion({ profileId });
    if (previousContext && previousContext.profileId !== profile.id) {
      await this.repository.setActiveCareerContext(previousContext);
    }
    await this.refresh();
    this.selectManagerItem(profile.personId, profile.id);
    return profile;
  }

  async rename(profileId: string, profileVersionLabel: string) {
    const profile = await this.repository.renameProfileVersion(profileId, profileVersionLabel);
    await this.refresh();
    this.selectManagerItem(profile.personId, profile.id);
    return profile;
  }

  async setCurrent(profileId: string) {
    const profile = await this.repository.setCurrentProfileVersion(profileId);
    await this.refresh();
    this.selectManagerItem(profile.personId, profile.id);
    return profile;
  }

  async archive(input: { profileId?: string; personId?: string; expectedRevision?: number; expectedUpdatedAt?: string; operationId?: string }) {
    const result = input.profileId
      ? await this.repository.archiveProfileVersion({ profileId: input.profileId, expectedRevision: input.expectedRevision, operationId: input.operationId })
      : await this.repository.archivePerson({ personId: input.personId!, expectedUpdatedAt: input.expectedUpdatedAt, operationId: input.operationId });
    await this.refresh();
    return result;
  }

  async restore(input: { profileId?: string; personId?: string; expectedRevision?: number; expectedUpdatedAt?: string; operationId?: string; fromTrash?: boolean }) {
    const result = input.profileId
      ? input.fromTrash
        ? await this.repository.restoreProfileVersionFromTrash({ profileId: input.profileId, expectedRevision: input.expectedRevision, operationId: input.operationId })
        : await this.repository.restoreArchivedProfileVersion({ profileId: input.profileId, expectedRevision: input.expectedRevision, operationId: input.operationId })
      : input.fromTrash
        ? await this.repository.restorePersonFromTrash({ personId: input.personId!, expectedUpdatedAt: input.expectedUpdatedAt, operationId: input.operationId })
        : await this.repository.restoreArchivedPerson({ personId: input.personId!, expectedUpdatedAt: input.expectedUpdatedAt, operationId: input.operationId });
    await this.refresh();
    return result;
  }

  async trash(input: { profileId?: string; personId?: string; expectedRevision?: number; expectedUpdatedAt?: string; operationId?: string }) {
    const result = input.profileId
      ? await this.repository.trashProfileVersion({ profileId: input.profileId, expectedRevision: input.expectedRevision, operationId: input.operationId })
      : await this.repository.trashPerson({ personId: input.personId!, expectedUpdatedAt: input.expectedUpdatedAt, operationId: input.operationId });
    await this.refresh();
    return result;
  }

  async permanentlyDelete(input: { profileId?: string; personId?: string; expectedRevision?: number; expectedUpdatedAt?: string; operationId?: string }) {
    const result = input.profileId
      ? await this.repository.permanentlyDeleteProfileVersion({ profileId: input.profileId, expectedRevision: input.expectedRevision, operationId: input.operationId })
      : await this.repository.permanentlyDeletePerson({ personId: input.personId!, expectedUpdatedAt: input.expectedUpdatedAt, operationId: input.operationId });
    await this.refresh();
    return result;
  }
}

export const careerContextStore = new CareerContextStore();

const careerContextActions = {
  refresh: () => careerContextStore.refresh(),
  selectManagerItem: (personId?: string, profileId?: string) => careerContextStore.selectManagerItem(personId, profileId),
  selectContext: (input: Pick<ActiveCareerContext, "personId" | "profileId">) => careerContextStore.selectContext(input),
  createPerson: (displayName: string) => careerContextStore.createPerson(displayName),
  createVersion: (profileId: string) => careerContextStore.createVersion(profileId),
  rename: (profileId: string, profileVersionLabel: string) => careerContextStore.rename(profileId, profileVersionLabel),
  setCurrent: (profileId: string) => careerContextStore.setCurrent(profileId),
  archive: (input: Parameters<CareerContextStore["archive"]>[0]) => careerContextStore.archive(input),
  restore: (input: Parameters<CareerContextStore["restore"]>[0]) => careerContextStore.restore(input),
  trash: (input: Parameters<CareerContextStore["trash"]>[0]) => careerContextStore.trash(input),
  permanentlyDelete: (input: Parameters<CareerContextStore["permanentlyDelete"]>[0]) => careerContextStore.permanentlyDelete(input)
};

export function useCareerContextStore() {
  const snapshot = useSyncExternalStore(careerContextStore.subscribe, careerContextStore.getSnapshot, careerContextStore.getServerSnapshot);
  useEffect(() => {
    void careerContextStore.refresh();
    const listener = () => { void careerContextStore.refresh(); };
    window.addEventListener("careeradapt-career-context-change", listener);
    return () => window.removeEventListener("careeradapt-career-context-change", listener);
  }, []);
  return { ...snapshot, ...careerContextActions };
}

export function CareerContextProvider({ children }: { children: ReactNode }) {
  return <CareerContextProviderInner>{children}</CareerContextProviderInner>;
}

function CareerContextProviderInner({ children }: { children: ReactNode }) {
  useEffect(() => { void careerContextStore.refresh(); }, []);
  return children;
}
