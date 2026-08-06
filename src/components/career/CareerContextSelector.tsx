"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActiveCareerContext, CareerPerson, CareerProfile } from "@/domain/schemas";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { WorkspaceRepository } from "@/services/storage/repositories";

const repository = new WorkspaceRepository();

export type CareerContextSelection = ActiveCareerContext;

export function CareerContextSelector({
  className = "",
  onBeforeSelect
}: {
  className?: string;
  onBeforeSelect?: (context: CareerContextSelection) => Promise<boolean | void> | boolean | void;
}) {
  const [context, setContext] = useState<ActiveCareerContext>();
  const [persons, setPersons] = useState<CareerPerson[]>([]);
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [nextPersons, nextProfiles, nextContext] = await Promise.all([
      repository.listCareerPersons(),
      repository.listProfiles(),
      repository.getActiveCareerContext()
    ]);
    setPersons(nextPersons);
    setProfiles(nextProfiles);
    setContext(nextContext);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.listCareerPersons(),
      repository.listProfiles(),
      repository.getActiveCareerContext()
    ]).then(([nextPersons, nextProfiles, nextContext]) => {
      if (!active) return;
      setPersons(nextPersons);
      setProfiles(nextProfiles);
      setContext(nextContext);
    });
    const listener = () => { void refresh(); };
    window.addEventListener("careeradapt-career-context-change", listener);
    return () => {
      active = false;
      window.removeEventListener("careeradapt-career-context-change", listener);
    };
  }, []);

  const activeProfile = profiles.find((profile) => profile.id === context?.profileId);
  const activePerson = persons.find((person) => person.id === context?.personId);
  const activeItemCount = activeProfile ? profileItemCount(activeProfile) : 0;
  const label = activePerson && activeProfile
    ? `${activePerson.displayName} · ${profileVersionLabel(activeProfile)}`
    : "选择人物与版本";
  const subtitle = activeProfile
    ? `创建于 ${formatDate(activeProfile.createdAt)} · ${activeItemCount} 项资料`
    : "没有默认人物；请选择后继续";

  async function selectContext(next: ActiveCareerContext) {
    if (next.profileId === context?.profileId && next.personId === context?.personId) {
      setOpen(false);
      return;
    }
    const allowed = await onBeforeSelect?.(next);
    if (allowed === false) return;
    setBusy(true);
    try {
      const saved = await repository.setActiveCareerContext(next);
      setContext(saved);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change", { detail: saved }));
    } finally {
      setBusy(false);
    }
  }

  async function createPerson() {
    const name = newPersonName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await repository.createPerson(name);
      setNewPersonName("");
      setCreatingPerson(false);
      await refresh();
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
    } finally {
      setBusy(false);
    }
  }

  async function createVersion() {
    if (!activeProfile) return;
    setBusy(true);
    try {
      await repository.createProfileVersion({ profileId: activeProfile.id });
      await refresh();
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
    } finally {
      setBusy(false);
    }
  }

  async function setCurrent() {
    if (!activeProfile?.personId) return;
    setBusy(true);
    try {
      await repository.setCurrentProfileVersion(activeProfile.id);
      await refresh();
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
    } finally {
      setBusy(false);
    }
  }

  async function renameVersion() {
    if (!activeProfile) return;
    const next = window.prompt("版本名称（可选）", activeProfile.profileVersionLabel ?? "");
    if (next === null) return;
    setBusy(true);
    try {
      await repository.renameProfileVersion(activeProfile.id, next);
      await refresh();
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
    } finally {
      setBusy(false);
    }
  }

  async function archiveVersion() {
    if (!activeProfile || !window.confirm(`归档 ${activePerson?.displayName ?? "当前人物"} 的 ${profileVersionLabel(activeProfile)}？`)) return;
    setBusy(true);
    try {
      await repository.archiveProfileVersion(activeProfile.id);
      await refresh();
      window.dispatchEvent(new CustomEvent("careeradapt-career-context-change"));
    } finally {
      setBusy(false);
    }
  }

  const profilesByPerson = useMemo(() => new Map(persons.map((person) => [
    person.id,
    profiles.filter((profile) => profile.personId === person.id)
  ])), [persons, profiles]);

  return (
    <div className={`career-context-selector ${className}`}>
      <button
        type="button"
        className="career-context-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        <span className="career-context-trigger-copy">
          <strong>{label}</strong>
          <small>{subtitle}</small>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div className="career-context-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="career-context-dialog" role="dialog" aria-modal="true" aria-labelledby="career-context-dialog-title">
            <header>
              <div>
                <h2 id="career-context-dialog-title">人物与版本</h2>
                <p>所有页面和新任务都会使用这里选中的人物与资料版本。</p>
              </div>
              <button type="button" className="career-context-close" aria-label="关闭人物与版本选择器" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="career-context-list">
              {persons.map((person) => (
                <section key={person.id} className="career-context-person">
                  <h3>{person.displayName}</h3>
                  {(profilesByPerson.get(person.id) ?? []).map((profile) => {
                    const selected = profile.id === context?.profileId;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className={selected ? "career-context-option is-selected" : "career-context-option"}
                        disabled={Boolean(profile.archivedAt) || busy}
                        onClick={() => void selectContext(toContext(person, profile))}
                      >
                        <span>
                          <strong>{profileVersionLabel(profile)}{profile.profileVersionLabel ? ` · ${profile.profileVersionLabel}` : ""}</strong>
                          <small>创建于 {formatDate(profile.createdAt)} · {profileItemCount(profile)} 项资料{profile.isCurrent ? " · 当前" : ""}{profile.archivedAt ? " · 已归档" : ""}</small>
                        </span>
                        {selected ? <b>已选</b> : null}
                      </button>
                    );
                  })}
                </section>
              ))}
              {persons.length === 0 ? <p className="career-context-empty">还没有人物，请先创建一个。</p> : null}
            </div>
            <div className="career-context-actions">
              <button type="button" className="secondary-button compact" onClick={() => setCreatingPerson((value) => !value)}>新建人物</button>
              <button type="button" className="secondary-button compact" disabled={!activeProfile || busy} onClick={() => void createVersion()}>基于当前新建版本</button>
              <button type="button" className="secondary-button compact" disabled={!activeProfile || busy} onClick={() => void setCurrent()}>设为当前版本</button>
              <button type="button" className="secondary-button compact" disabled={!activeProfile || busy} onClick={() => void renameVersion()}>重命名版本</button>
              <button type="button" className="danger-button compact" disabled={!activeProfile || busy} onClick={() => void archiveVersion()}>归档版本</button>
              <button type="button" className="section-action-button compact" onClick={() => setOpen(true)}>人物与版本管理</button>
            </div>
            {creatingPerson ? (
              <form className="career-context-create-form" onSubmit={(event) => { event.preventDefault(); void createPerson(); }}>
                <label htmlFor="career-context-new-person">人物名称</label>
                <input id="career-context-new-person" name="person-name" autoComplete="name" value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="例如：张三…" />
                <button type="submit" className="primary-button compact" disabled={busy || !newPersonName.trim()}>创建并使用</button>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function toContext(person: CareerPerson, profile: CareerProfile): ActiveCareerContext {
  return {
    schemaVersion: "active-career-v1",
    personId: person.id,
    profileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1,
    profileRevision: profile.version,
    selectedAt: new Date().toISOString()
  };
}

function profileVersionLabel(profile: CareerProfile) {
  return `V${profile.profileVersionNumber ?? 1}`;
}

function profileItemCount(profile: CareerProfile) {
  return canonicalProfileLibraryItems(profile).length;
}

function formatDate(value: string) {
  return value.slice(0, 10);
}
