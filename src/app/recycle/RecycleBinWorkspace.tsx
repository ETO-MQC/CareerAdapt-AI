"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobDescription, ProfileRecycleItem, RecycleBinState, ResumeBranch } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { readDeveloperMode } from "@/services/preferences/developerMode";
import { notify } from "@/services/notifications/store";
import {
  ProductSurface,
  ProductTopbar
} from "@/components/ui/product";

const repository = new WorkspaceRepository();
type RecycleFilter = "all" | "resume" | "profile" | "job";
type PendingDelete = { kind: "resume"; item: ResumeBranch } | { kind: "profile"; item: ProfileRecycleItem } | { kind: "job"; item: JobDescription };

export function RecycleBinWorkspace() {
  const [state, setState] = useState<RecycleBinState>({ version: 1, jobIds: [], profileItems: [] });
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [filter, setFilter] = useState<RecycleFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>();
  const [confirmation, setConfirmation] = useState("");
  const [developerMode] = useState(() => typeof window !== "undefined" && readDeveloperMode());

  async function refresh() {
    const [nextState, nextBranches, nextJobs] = await Promise.all([
      repository.getRecycleBinState(),
      repository.listResumeBranches(),
      repository.listJobDescriptions()
    ]);
    setState(nextState);
    setBranches(nextBranches.filter((branch) => branch.lifecycleStatus === "trashed"));
    setJobs(nextJobs.filter((job) => nextState.jobIds.includes(job.id)));
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

  const total = branches.length + state.profileItems.length + jobs.length;
  const sections = useMemo(() => ({
    resume: filter === "all" || filter === "resume",
    profile: filter === "all" || filter === "profile",
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
    } else {
      await repository.deleteProfileRecycleItemPermanently(pendingDelete.item.kind, pendingDelete.item.id);
      notify({ type: "success", title: "删除成功", message: "资料条目已永久删除。" });
    }
    setPendingDelete(undefined);
    setConfirmation("");
    await refresh();
  }

  async function quickCleanRecycleBin() {
    if (!developerMode || !window.confirm("清理所有未被引用的回收站内容？此操作无法恢复。")) return;
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
    notify({ type: protectedCount > 0 ? "warning" : "success", title: "快速清理完成", message: `永久删除 ${deleted} 项，保留 ${protectedCount} 项受引用保护的内容。` });
    await refresh();
  }

  return (
    <main className="page-shell recycle-workspace">
      <ProductTopbar title="回收站" status={`${total} 项已删除内容`} />
      <ProductSurface className="recycle-panel">
        <div className="section-heading compact-heading"><div><h2>已删除内容</h2><p>共 {total} 项</p></div>{developerMode && total > 0 ? <button className="danger-button compact" type="button" onClick={() => { void quickCleanRecycleBin(); }}>快速清理</button> : null}</div>
        <div className="resume-filter-row" role="tablist" aria-label="回收站分类">
          {([['all', '全部', total], ['resume', '简历', branches.length], ['profile', '资料', state.profileItems.length], ['job', '岗位', jobs.length]] as const).map(([key, label, count]) => (
            <button key={key} type="button" className={filter === key ? "secondary-button compact filter-active" : "secondary-button compact"} onClick={() => setFilter(key)}>{label} {count}</button>
          ))}
        </div>
        <div className="recycle-section-list">
          {sections.resume && branches.length > 0 ? <RecycleSection title="简历">{branches.map((branch) => <RecycleRow key={branch.id} title={branch.name} meta="恢复后进入归档列表" onRestore={() => { void restoreResume(branch); }} onDelete={() => { setPendingDelete({ kind: "resume", item: branch }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {sections.profile && state.profileItems.length > 0 ? <RecycleSection title="个人资料">{state.profileItems.map((item) => <RecycleRow key={`${item.kind}:${item.id}`} title={item.title} meta="恢复后回到原个人资料" onRestore={() => { void restoreProfile(item); }} onDelete={() => { setPendingDelete({ kind: "profile", item }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {sections.job && jobs.length > 0 ? <RecycleSection title="岗位">{jobs.map((job) => <RecycleRow key={job.id} title={`${job.company} / ${job.title}`} meta="恢复后进入当前岗位" onRestore={() => { void restoreJob(job); }} onDelete={() => { setPendingDelete({ kind: "job", item: job }); setConfirmation(""); }} />)}</RecycleSection> : null}
          {total === 0 ? <p className="recycle-empty">回收站为空。</p> : null}
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
    </main>
  );
}

function RecycleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="recycle-section"><div className="recycle-section-heading"><h3>{title}</h3></div><div className="recycle-list">{children}</div></section>;
}

function RecycleRow({ title, meta, onRestore, onDelete }: { title: string; meta: string; onRestore: () => void; onDelete: () => void }) {
  return <article className="recycle-row product-data-row"><div><strong>{title}</strong><span>{meta}</span></div><div className="action-row"><button className="secondary-button compact" type="button" onClick={onRestore}>恢复</button><button className="danger-button compact" type="button" onClick={onDelete}>永久删除</button></div></article>;
}

function deleteLabel(item: PendingDelete) {
  return item.kind === "resume" ? item.item.name : item.kind === "job" ? `${item.item.company} / ${item.item.title}` : item.item.title;
}
