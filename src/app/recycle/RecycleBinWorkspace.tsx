"use client";

import { useEffect, useMemo, useState } from "react";
import type { CareerPerson, CareerProfile, JobDescription, ProfileRecycleItem, RecycleBinState, ResumeBranch } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { readDeveloperMode } from "@/services/preferences/developerMode";
import { notify } from "@/services/notifications/store";
import { ProductSurface, ProductTopbar } from "@/components/ui/product";
import { useCareerContextStore } from "@/services/career/CareerContextStore";

const repository = new WorkspaceRepository();
type RecycleFilter = "all" | "resume" | "profile_item" | "person_version" | "job";
type PendingDelete =
  | { kind: "resume"; item: ResumeBranch }
  | { kind: "profile"; item: ProfileRecycleItem }
  | { kind: "job"; item: JobDescription }
  | { kind: "career_profile"; item: CareerProfile }
  | { kind: "career_person"; item: CareerPerson };

export function RecycleBinWorkspace() {
  const [state, setState] = useState<RecycleBinState>({ version: 1, jobIds: [], profileItems: [] });
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [filter, setFilter] = useState<RecycleFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>();
  const [confirmation, setConfirmation] = useState("");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [quickCleanOpen, setQuickCleanOpen] = useState(false);
  const [developerMode] = useState(() => typeof window !== "undefined" && readDeveloperMode());
  const career = useCareerContextStore();

  async function refresh() {
    const [nextState, nextBranches, nextJobs] = await Promise.all([
      repository.getRecycleBinState(),
      repository.listResumeBranches(),
      repository.listJobDescriptions()
    ]);
    setState(nextState);
    setBranches(nextBranches.filter((branch) => branch.lifecycleStatus === "trashed"));
    setJobs(nextJobs.filter((job) => nextState.jobIds.includes(job.id)));
    await career.refresh();
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getRecycleBinState(),
      repository.listResumeBranches(),
      repository.listJobDescriptions()
    ]).then(([nextState, nextBranches, nextJobs]) => {
      if (!active) return;
      setState(nextState);
      setBranches(nextBranches.filter((branch) => branch.lifecycleStatus === "trashed"));
      setJobs(nextJobs.filter((job) => nextState.jobIds.includes(job.id)));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pendingDelete) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPendingDelete(undefined); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [pendingDelete]);

  const trashedProfiles = career.profiles.filter((profile) => Boolean(profile.trashedAt));
  const trashedPersons = career.persons.filter((person) => Boolean(person.trashedAt));
  const query = search.trim().toLocaleLowerCase();
  const filteredBranches = branches.filter((branch) => matchesRecycleSearch(query, `${branch.name} ${branch.profileId}`));
  const filteredProfileItems = state.profileItems.filter((item) => matchesRecycleSearch(query, `${item.title} ${item.category} ${item.profileId}`));
  const filteredProfiles = trashedProfiles.filter((profile) => matchesRecycleSearch(query, `${profile.name} V${profile.profileVersionNumber ?? 1} ${profile.personId}`));
  const filteredPersons = trashedPersons.filter((person) => matchesRecycleSearch(query, `${person.displayName} ${person.id}`));
  const filteredJobs = jobs.filter((job) => matchesRecycleSearch(query, `${job.company} ${job.title}`));
  const total = branches.length + state.profileItems.length + jobs.length + trashedProfiles.length + trashedPersons.length;
  const sections = useMemo(() => ({
    resume: filter === "all" || filter === "resume",
    profile: filter === "all" || filter === "profile_item",
    personVersion: filter === "all" || filter === "person_version",
    job: filter === "all" || filter === "job"
  }), [filter]);

  async function restoreResume(branch: ResumeBranch) {
    await repository.restoreResumeBranchFromTrash({ branchId: branch.id, expectedRevision: branch.revision, operationId: `recycle-restore-${branch.id}-${branch.revision}` });
    notify({ type: "success", title: "恢复成功", message: "简历已恢复到归档列表。" });
    await refresh();
  }

  async function restoreProfile(item: ProfileRecycleItem) {
    await repository.restoreProfileRecycleItem(item.kind, item.id);
    notify({ type: "success", title: "恢复成功", message: "资料条目已恢复到个人资料库。" });
    await refresh();
  }

  async function restoreJob(job: JobDescription) {
    await repository.restoreJobFromRecycleBin(job.id);
    notify({ type: "success", title: "恢复成功", message: "岗位已恢复到当前岗位列表。" });
    await refresh();
  }

  async function restoreCareerProfile(profile: CareerProfile) {
    try {
      await career.restore({ profileId: profile.id, expectedRevision: profile.version, fromTrash: true, operationId: `recycle-restore-profile-${profile.id}-${profile.version}` });
      notify({ type: "success", title: "版本已恢复", message: "人物版本已恢复，可在人物与版本管理中继续使用。" });
      await refresh();
    } catch (error) {
      notify({ type: "error", title: "恢复失败", message: lifecycleRecycleError(error) });
    }
  }

  async function restoreCareerPerson(person: CareerPerson) {
    try {
      await career.restore({ personId: person.id, expectedUpdatedAt: person.updatedAt, fromTrash: true, operationId: `recycle-restore-person-${person.id}-${person.updatedAt}` });
      notify({ type: "success", title: "人物已恢复", message: "人物已从回收站恢复。" });
      await refresh();
    } catch (error) {
      notify({ type: "error", title: "恢复失败", message: lifecycleRecycleError(error) });
    }
  }

  async function permanentlyDelete() {
    if (!pendingDelete || (!developerMode && confirmation.trim() !== deleteLabel(pendingDelete))) return;
    if (pendingDelete.kind === "resume") {
      const result = await repository.deleteResumeBranchPermanently({ branchId: pendingDelete.item.id, expectedRevision: pendingDelete.item.revision });
      if (!result.deleted) notify({ type: "warning", title: "无法永久删除", message: `仍有 ${result.blockers.applications} 条求职记录或 ${result.blockers.derivedBranches} 份派生简历引用。` });
      else notify({ type: "success", title: "删除成功", message: "简历已永久删除。" });
    } else if (pendingDelete.kind === "job") {
      const result = await repository.deleteJobPermanently(pendingDelete.item.id);
      if (!result.deleted) notify({ type: "warning", title: "无法永久删除", message: `仍有 ${Object.values(result.blockers).reduce((sum, count) => sum + count, 0)} 条关联数据。` });
      else notify({ type: "success", title: "删除成功", message: "岗位已永久删除。" });
    } else if (pendingDelete.kind === "career_profile") {
      const result = await career.permanentlyDelete({ profileId: pendingDelete.item.id, expectedRevision: pendingDelete.item.version, operationId: `recycle-delete-profile-${pendingDelete.item.id}-${pendingDelete.item.version}` });
      if (!result.deleted) notify({ type: "warning", title: "无法永久删除", message: lifecycleBlockerMessage(result.blockers) });
      else notify({ type: "success", title: "删除成功", message: "人物版本已永久删除。" });
    } else if (pendingDelete.kind === "career_person") {
      const result = await career.permanentlyDelete({ personId: pendingDelete.item.id, expectedUpdatedAt: pendingDelete.item.updatedAt, operationId: `recycle-delete-person-${pendingDelete.item.id}-${pendingDelete.item.updatedAt}` });
      if (!result.deleted) notify({ type: "warning", title: "无法永久删除", message: lifecycleBlockerMessage(result.blockers) });
      else notify({ type: "success", title: "删除成功", message: "人物及其已清空版本已永久删除。" });
    } else {
      await repository.deleteProfileRecycleItemPermanently(pendingDelete.item.kind, pendingDelete.item.id);
      notify({ type: "success", title: "删除成功", message: "资料条目已永久删除。" });
    }
    setPendingDelete(undefined);
    setConfirmation("");
    await refresh();
  }

  async function quickCleanRecycleBin() {
    if (!developerMode) return;
    setQuickCleanOpen(false);
    let deleted = 0;
    let protectedCount = 0;
    for (const branch of branches) {
      const result = await repository.deleteResumeBranchPermanently({ branchId: branch.id, expectedRevision: branch.revision });
      if (result.deleted) deleted += 1;
      else protectedCount += 1;
    }
    for (const item of state.profileItems) {
      await repository.deleteProfileRecycleItemPermanently(item.kind, item.id);
      deleted += 1;
    }
    for (const job of jobs) {
      const result = await repository.deleteJobPermanently(job.id);
      if (result.deleted) deleted += 1;
      else protectedCount += 1;
    }
    for (const profile of trashedProfiles) {
      const result = await career.permanentlyDelete({ profileId: profile.id, expectedRevision: profile.version, operationId: `recycle-clean-profile-${profile.id}-${profile.version}` });
      if (result.deleted) deleted += 1;
      else protectedCount += 1;
    }
    for (const person of trashedPersons) {
      const result = await career.permanentlyDelete({ personId: person.id, expectedUpdatedAt: person.updatedAt, operationId: `recycle-clean-person-${person.id}-${person.updatedAt}` });
      if (result.deleted) deleted += 1;
      else protectedCount += 1;
    }
    notify({ type: protectedCount > 0 ? "warning" : "success", title: "快速清理完成", message: `永久删除 ${deleted} 项，保留 ${protectedCount} 项受引用保护的内容。` });
    await refresh();
  }

  async function restoreSelected() {
    if (!selectedKeys.size) return;
    for (const branch of branches) if (selectedKeys.has(`resume:${branch.id}`)) await restoreResume(branch);
    for (const item of state.profileItems) if (selectedKeys.has(`profile:${item.kind}:${item.id}`)) await restoreProfile(item);
    for (const job of jobs) if (selectedKeys.has(`job:${job.id}`)) await restoreJob(job);
    for (const profile of trashedProfiles) if (selectedKeys.has(`career-profile:${profile.id}`)) await restoreCareerProfile(profile);
    for (const person of trashedPersons) if (selectedKeys.has(`career-person:${person.id}`)) await restoreCareerPerson(person);
    setSelectedKeys(new Set());
  }

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function showCareerBlockers(id: string, kind: "person" | "profile") {
    if (kind === "profile") {
      const blockers = await repository.getProfileDeleteBlockers(id);
      notify({ type: "info", title: "引用保护状态", message: lifecycleBlockerMessage(blockers) === "仍有引用或版本阻塞，暂不能永久删除。" ? "当前没有可见引用阻塞。" : lifecycleBlockerMessage(blockers) });
      return;
    }
    const ownedProfiles = career.profiles.filter((profile) => profile.personId === id);
    const blockerGroups = await Promise.all(ownedProfiles.map((profile) => repository.getProfileDeleteBlockers(profile.id)));
    const blockers = blockerGroups.reduce<Record<string, number>>((result, group) => {
      for (const [key, count] of Object.entries(group)) result[key] = (result[key] ?? 0) + count;
      return result;
    }, { profiles: ownedProfiles.length });
    notify({ type: "info", title: "人物引用保护状态", message: lifecycleBlockerMessage(blockers) === "仍有引用或版本阻塞，暂不能永久删除。" ? "当前没有可见引用阻塞。" : lifecycleBlockerMessage(blockers) });
  }

  return (
    <main className="page-shell recycle-workspace">
      <ProductTopbar title="回收站" status={`${total} 项已删除内容`} />
      <ProductSurface className="recycle-panel">
        <div className="section-heading compact-heading">
          <div><h2>已删除内容</h2><p>共 {total} 项 · 简历 {branches.length} · 资料条目 {state.profileItems.length} · 人物与版本 {trashedPersons.length + trashedProfiles.length} · 岗位 {jobs.length}</p></div>
          <div className="recycle-header-actions">
            {selectedKeys.size ? <button className="secondary-button compact" type="button" onClick={() => { void restoreSelected(); }}>恢复所选 ({selectedKeys.size})</button> : null}
            {developerMode && total > 0 ? <button className="danger-button compact" type="button" onClick={() => setQuickCleanOpen(true)}>快速清理</button> : null}
          </div>
        </div>
        <div className="recycle-search-field">
          <label className="recycle-search-label" htmlFor="recycle-search">搜索回收站</label>
          <input id="recycle-search" className="recycle-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、人物、版本或岗位" />
        </div>
        <div className="resume-filter-row" role="tablist" aria-label="回收站分类">
          {([['all', '全部', total], ['resume', '简历', branches.length], ['profile_item', '资料条目', state.profileItems.length], ['person_version', '人物与版本', trashedPersons.length + trashedProfiles.length], ['job', '岗位', jobs.length]] as const).map(([key, label, count]) => (
            <button key={key} type="button" className={filter === key ? "secondary-button compact filter-active" : "secondary-button compact"} onClick={() => setFilter(key)}>{label} {count}</button>
          ))}
        </div>
        <div className="recycle-section-list">
          {sections.resume && filteredBranches.length > 0 ? <RecycleSection title="简历">{filteredBranches.map((branch) => <RecycleRow key={branch.id} itemKey={`resume:${branch.id}`} selected={selectedKeys.has(`resume:${branch.id}`)} onSelect={() => toggleSelected(`resume:${branch.id}`)} title={branch.name} meta="恢复后进入归档列表" onRestore={() => { void restoreResume(branch); }} onDelete={() => { setPendingDelete({ kind: "resume", item: branch }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {sections.profile && filteredProfileItems.length > 0 ? <RecycleSection title="资料条目">{filteredProfileItems.map((item) => <RecycleRow key={`${item.kind}:${item.id}`} itemKey={`profile:${item.kind}:${item.id}`} selected={selectedKeys.has(`profile:${item.kind}:${item.id}`)} onSelect={() => toggleSelected(`profile:${item.kind}:${item.id}`)} title={item.title} meta={`${item.category} · 恢复后回到原个人资料`} onRestore={() => { void restoreProfile(item); }} onDelete={() => { setPendingDelete({ kind: "profile", item }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {sections.personVersion && filteredPersons.length > 0 ? <RecycleSection title="人物与版本">{filteredPersons.map((person) => <RecycleRow key={person.id} itemKey={`career-person:${person.id}`} selected={selectedKeys.has(`career-person:${person.id}`)} onSelect={() => toggleSelected(`career-person:${person.id}`)} title={person.displayName} meta="人物容器 · 可恢复；永久删除前需清空版本和引用" onRestore={() => { void restoreCareerPerson(person); }} onDelete={() => { setPendingDelete({ kind: "career_person", item: person }); setConfirmation(""); }} onBlockers={() => void showCareerBlockers(person.id, "person")} />)}</RecycleSection> : null}
           {sections.personVersion && filteredProfiles.length > 0 ? <RecycleSection title="人物版本">{filteredProfiles.map((profile) => <RecycleRow key={profile.id} itemKey={`career-profile:${profile.id}`} selected={selectedKeys.has(`career-profile:${profile.id}`)} onSelect={() => toggleSelected(`career-profile:${profile.id}`)} title={`${profile.name} · V${profile.profileVersionNumber ?? 1}`} meta={`${profile.profileVersionLabel ?? "版本"} · 删除日期 ${formatRecycleDate(profile.trashedAt)}`} onRestore={() => { void restoreCareerProfile(profile); }} onDelete={() => { setPendingDelete({ kind: "career_profile", item: profile }); setConfirmation(""); }} onBlockers={() => void showCareerBlockers(profile.id, "profile")} />)}</RecycleSection> : null}
          {sections.job && filteredJobs.length > 0 ? <RecycleSection title="岗位">{filteredJobs.map((job) => <RecycleRow key={job.id} itemKey={`job:${job.id}`} selected={selectedKeys.has(`job:${job.id}`)} onSelect={() => toggleSelected(`job:${job.id}`)} title={`${job.company} / ${job.title}`} meta="恢复后进入当前岗位" onRestore={() => { void restoreJob(job); }} onDelete={() => { setPendingDelete({ kind: "job", item: job }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {total === 0 ? <p className="recycle-empty">回收站为空。</p> : null}
          {total > 0 && !filteredBranches.length && !filteredProfileItems.length && !filteredPersons.length && !filteredProfiles.length && !filteredJobs.length ? <p className="recycle-empty">没有匹配的内容。</p> : null}
        </div>
      </ProductSurface>
      {pendingDelete ? <div className="sync-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDelete(undefined); }}>
        <section className="sync-dialog profile-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="recycle-delete-title">
          <h2 id="recycle-delete-title">永久删除？</h2>
          <p>{developerMode ? "开发者模式已开启，无需输入名称；受其他数据引用的内容仍不会删除。" : `此操作无法恢复。请输入完整名称“${deleteLabel(pendingDelete)}”确认。`}</p>
          {!developerMode ? <label className="field-label" htmlFor="recycle-delete-confirm">名称<input id="recycle-delete-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label> : null}
          <div className="action-row"><button className="secondary-button" type="button" onClick={() => setPendingDelete(undefined)}>取消</button><button className="danger-button" type="button" disabled={!developerMode && confirmation.trim() !== deleteLabel(pendingDelete)} onClick={() => { void permanentlyDelete(); }}>永久删除</button></div>
        </section>
      </div> : null}
      {quickCleanOpen ? <div className="sync-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickCleanOpen(false); }}>
        <section className="sync-dialog profile-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="recycle-clean-title">
          <h2 id="recycle-clean-title">快速清理回收站？</h2>
          <p>仅开发者模式可用。系统会尝试永久删除未被引用的内容，受引用保护的内容会保留。</p>
          <div className="action-row"><button className="secondary-button" type="button" onClick={() => setQuickCleanOpen(false)}>取消</button><button className="danger-button" type="button" onClick={() => { void quickCleanRecycleBin(); }}>确认清理</button></div>
        </section>
      </div> : null}
    </main>
  );
}

function RecycleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="recycle-section"><div className="recycle-section-heading"><h3>{title}</h3></div><div className="recycle-list">{children}</div></section>;
}

function RecycleRow({ selected, title, meta, onSelect, onRestore, onDelete, onBlockers }: { itemKey: string; selected: boolean; title: string; meta: string; onSelect: () => void; onRestore: () => void; onDelete: () => void; onBlockers?: () => void }) {
  return <article className="recycle-row product-data-row">
    <div className="recycle-row-main">
      <label className="recycle-row-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`选择 ${title}`} /></label>
      <div className="recycle-row-content"><strong>{title}</strong><span>{meta}</span></div>
    </div>
    <div className="action-row recycle-row-actions"><button className="secondary-button compact" type="button" onClick={onRestore}>恢复</button>{onBlockers ? <button className="section-action-button compact" type="button" onClick={onBlockers}>查看阻塞</button> : null}<button className="danger-button compact" type="button" onClick={onDelete}>永久删除</button></div>
  </article>;
}

function deleteLabel(item: PendingDelete) {
  if (item.kind === "resume") return item.item.name;
  if (item.kind === "job") return `${item.item.company} / ${item.item.title}`;
  if (item.kind === "career_profile") return `${item.item.name} · V${item.item.profileVersionNumber ?? 1}`;
  if (item.kind === "career_person") return item.item.displayName;
  return item.item.title;
}

function matchesRecycleSearch(query: string, value: string) {
  return !query || value.toLocaleLowerCase().includes(query);
}

function formatRecycleDate(value?: string) {
  if (!value) return "未知";
  return value.slice(0, 10);
}

function lifecycleBlockerMessage(blockers: Record<string, number>) {
  const entries = Object.entries(blockers).filter(([, count]) => count > 0).map(([key, count]) => `${key} ${count}`);
  return entries.length ? `仍有引用阻塞：${entries.join("、")}。` : "仍有引用或版本阻塞，暂不能永久删除。";
}

function lifecycleRecycleError(error: unknown) {
  const code = error instanceof Error ? error.message : "unknown";
  if (code === "career_profile_current_cannot_trash") return "当前版本不能移入回收站，请先切换到其他有效版本。";
  if (code === "career_profile_not_in_trash" || code === "career_person_not_in_trash") return "该内容已不在回收站中，请刷新后重试。";
  return "生命周期状态已变化，请刷新后重试。";
}
