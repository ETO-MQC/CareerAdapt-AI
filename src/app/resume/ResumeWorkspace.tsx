"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type JobAdaptationDraft,
  type ResumeBranch,
  type ResumeRevision
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

const repository = new WorkspaceRepository();

export function ResumeWorkspace() {
  const workspace = useWorkspace(repository);
  const [drafts, setDrafts] = useState<JobAdaptationDraft[]>([]);
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [revisions, setRevisions] = useState<ResumeRevision[]>([]);
  const [message, setMessage] = useState<string | undefined>();
  const [draftName, setDraftName] = useState("");
  const [editTexts, setEditTexts] = useState<Record<string, string>>({});

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = useMemo(() => workspace.status === "ready" ? workspace.jobs : [], [workspace]);
  const activeDraftId = selectedDraftId || drafts[0]?.id || "";
  const activeBranchId = selectedBranchId || branches[0]?.id || "";
  const selectedDraft = drafts.find((draft) => draft.id === activeDraftId);
  const selectedBranch = branches.find((branch) => branch.id === activeBranchId);
  const selectedBranchJob = selectedBranch ? jobs.find((job) => job.id === selectedBranch.jobId) : undefined;

  const refreshLists = useCallback(async (profileId: string) => {
    const [nextDrafts, nextBranches] = await Promise.all([
      repository.listJobAdaptationDrafts(profileId),
      repository.listResumeBranches(profileId)
    ]);
    setDrafts(nextDrafts);
    setBranches(nextBranches);
  }, []);

  useEffect(() => {
    if (workspace.status !== "ready" || !profile) {
      return;
    }
    let active = true;
    async function loadLists() {
      const [nextDrafts, nextBranches] = await Promise.all([
        repository.listJobAdaptationDrafts(profile!.id),
        repository.listResumeBranches(profile!.id)
      ]);
      if (active) {
        setDrafts(nextDrafts);
        setBranches(nextBranches);
      }
    }
    void loadLists();
    return () => {
      active = false;
    };
  }, [workspace.status, profile]);

  useEffect(() => {
    if (!activeBranchId) {
      return;
    }
    let active = true;
    async function loadRevisions() {
      const next = await repository.listResumeRevisions(activeBranchId);
      if (active) {
        setRevisions(next);
      }
    }
    void loadRevisions();
    return () => {
      active = false;
    };
  }, [activeBranchId]);

  const draftOptions = useMemo(() => drafts.map((draft) => {
    const job = jobs.find((item) => item.id === draft.jobId);
    return {
      draft,
      label: `${job?.company ?? "Unknown"} / ${job?.title ?? draft.jobId} / revision ${draft.revision}`
    };
  }), [drafts, jobs]);

  async function createBranch() {
    if (!profile || !selectedDraft) {
      setMessage("请先选择可用的 C2 适配草稿。");
      return;
    }

    const job = jobs.find((item) => item.id === selectedDraft.jobId);
    const name = draftName.trim() || `${job?.company ?? "岗位"} / ${job?.title ?? "分支"}`;
    try {
      const result = await repository.createResumeBranchFromDraft({
        draftId: selectedDraft.id,
        expectedDraftRevision: selectedDraft.revision,
        operationId: `d1-create-${selectedDraft.id}-${selectedDraft.revision}`,
        name
      });
      await refreshLists(profile.id);
      setSelectedBranchId(result.branch.id);
      setMessage(result.idempotent ? "该草稿已经创建过正式分支，已恢复现有分支。" : "正式岗位分支已创建，并生成首个版本。");
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "创建失败：C2 草稿 revision 已变化，请刷新后重试。"
        : "创建失败：草稿可能已 stale、含高风险内容或引用了失效事实。请返回 C1/C2 修复。");
    }
  }

  async function saveItem(itemId: string) {
    if (!selectedBranch || selectedBranch.migrationStatus === "legacy_unverified") {
      return;
    }

    const text = editTexts[itemId]?.trim();
    if (!text) {
      setMessage("请先填写要保存的文本。");
      return;
    }

    try {
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-edit-${selectedBranch.id}-${selectedBranch.revision}-${itemId}-${stableHashText(text)}`,
        edits: [{ itemId, text }]
      });
      replaceBranch(result.branch);
      setSelectedBranchId(result.branch.id);
      setMessage("分支内容已保存，规则 Fact Guard 已由 Repository 重新计算。");
    } catch {
      setMessage("保存失败：可能存在高风险事实变更、revision 冲突或 legacy 分支只读。");
    }
  }

  async function toggleVisible(itemId: string, visible: boolean) {
    if (!selectedBranch || selectedBranch.migrationStatus === "legacy_unverified") {
      return;
    }
    try {
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-visible-${selectedBranch.id}-${selectedBranch.revision}-${itemId}-${visible}`,
        edits: [{ itemId, visible }]
      });
      replaceBranch(result.branch);
      setMessage("显示状态已保存，并创建新的分支版本。");
    } catch {
      setMessage("更新显示状态失败，请刷新后重试。");
    }
  }

  async function restoreRevision(revisionId: string) {
    if (!selectedBranch || selectedBranch.migrationStatus === "legacy_unverified") {
      return;
    }
    try {
      const result = await repository.restoreResumeRevision({
        branchId: selectedBranch.id,
        revisionId,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-restore-${selectedBranch.id}-${selectedBranch.revision}-${revisionId}`
      });
      replaceBranch(result.branch);
      setMessage("已恢复旧版本；恢复操作本身已作为新的 restore revision 追加。");
    } catch {
      setMessage("恢复失败：版本链缺失、revision 冲突或分支不可编辑。");
    }
  }

  async function undo() {
    if (!selectedBranch || selectedBranch.migrationStatus === "legacy_unverified") {
      return;
    }
    try {
      const result = await repository.undoResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-undo-${selectedBranch.id}-${selectedBranch.revision}`
      });
      replaceBranch(result.branch);
      setMessage("已按 previousRevisionId 链撤销最近一次分支修改。");
    } catch {
      setMessage("撤销失败：没有可撤销版本或当前分支已变化。");
    }
  }

  async function refreshSync() {
    if (!selectedBranch) {
      return;
    }
    const result = await repository.refreshResumeBranchSyncStatus({
      branchId: selectedBranch.id,
      operationId: `d1-refresh-sync-${selectedBranch.id}-${stableHashText(selectedBranch.syncStatusCache.checkedAt)}`
    });
    replaceBranch(result.branch);
    setMessage("syncStatus 已基于当前母档案、岗位和事实引用重新计算；分支内容未被自动覆盖。");
  }

  function replaceBranch(branch: ResumeBranch) {
    setBranches((current) => current.map((item) => item.id === branch.id ? branch : item));
    void repository.listResumeRevisions(branch.id).then(setRevisions);
  }

  if (workspace.status === "loading") {
    return (
      <main className="page-shell">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (workspace.status === "error") {
    return (
      <main className="page-shell">
        <WorkspaceErrorState message={workspace.error} />
      </main>
    );
  }

  if (workspace.status === "empty" || !profile) {
    return (
      <main className="page-shell">
        <WorkspaceEmptyState />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Stage D1 / Resume Branches</p>
        <h1>正式岗位分支</h1>
        <p>从 C2 适配草稿创建正式分支，分支只引用母档案事实，不覆盖职业母档案或岗位数据。</p>
      </section>

      {message ? <section className="notice">{message}</section> : null}

      <section className="stage-grid">
        <article className="panel">
          <h2>1. 从 C2 草稿创建分支</h2>
          {draftOptions.length > 0 ? (
            <>
              <label className="field-label">
                C2 适配草稿
                <select value={activeDraftId} onChange={(event) => setSelectedDraftId(event.target.value)}>
                  {draftOptions.map((option) => (
                    <option key={option.draft.id} value={option.draft.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="分支名称" />
              <button className="primary-button" onClick={createBranch}>创建正式分支</button>
            </>
          ) : (
            <p>暂无 C2 适配草稿。请先在岗位工作区完成 C1/C2。</p>
          )}
        </article>

        <article className="panel">
          <h2>2. 选择分支</h2>
          {branches.length > 0 ? (
            <div className="branch-list">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  className={`match-row ${branch.id === activeBranchId ? "match-row-active" : ""}`}
                  onClick={() => setSelectedBranchId(branch.id)}
                >
                  <strong>{branch.name}</strong>
                  <span>{branch.migrationStatus} / revision {branch.revision} / {branch.syncStatusCache.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无正式岗位分支。</p>
          )}
        </article>
      </section>

      {selectedBranch ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>{selectedBranch.name}</h2>
              <p>
                {selectedBranchJob ? `${selectedBranchJob.company} / ${selectedBranchJob.title}` : selectedBranch.jobId}
                {" "} / {selectedBranch.migrationStatus} / revision {selectedBranch.revision}
              </p>
            </div>
            <div className="action-row">
              <button className="secondary-button" onClick={refreshSync}>刷新更新提示</button>
              <button className="secondary-button" onClick={undo} disabled={selectedBranch.migrationStatus === "legacy_unverified"}>撤销</button>
            </div>
          </div>

          {selectedBranch.migrationStatus === "legacy_unverified" ? (
            <div className="warning-box">这是旧占位分支，已按 legacy_unverified 只读保留，不参与正式编辑、版本恢复或后续导出。</div>
          ) : null}

          {selectedBranch.syncStatusCache.status !== "in_sync" ? (
            <div className="warning-box">{selectedBranch.syncStatusCache.message}</div>
          ) : null}

          <div className="branch-editor">
            {selectedBranch.contentItems.map((item) => (
              <article key={item.id} className="suggestion-card">
                <div className="section-heading compact-heading">
                  <div>
                    <h3>{item.itemType} / {item.guardMode}</h3>
                    <p>{item.guardStatus} / {item.guardRiskLevel}</p>
                  </div>
                  <label className="inline-toggle">
                    <input
                      type="checkbox"
                      checked={item.visible}
                      disabled={selectedBranch.migrationStatus === "legacy_unverified"}
                      onChange={(event) => toggleVisible(item.id, event.target.checked)}
                    />
                    显示
                  </label>
                </div>
                {item.guardMode === "rule_only_verified" ? (
                  <div className="warning-box">规则 Fact Guard 已通过，但 AI 复核未完成。</div>
                ) : null}
                <textarea
                  className="textarea small-textarea"
                  value={editTexts[item.id] ?? item.text}
                  disabled={selectedBranch.migrationStatus === "legacy_unverified"}
                  onChange={(event) => setEditTexts((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <div className="action-row">
                  <button className="primary-button" disabled={selectedBranch.migrationStatus === "legacy_unverified"} onClick={() => saveItem(item.id)}>
                    保存
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selectedBranch ? (
        <section className="panel">
          <h2>版本历史</h2>
          {revisions.length > 0 ? (
            <div className="revision-list">
              {revisions.map((revision) => (
                <article key={revision.id} className="review-row">
                  <span>
                    <strong>revision {revision.revisionNumber}</strong>
                    <small>{revision.source} / previous: {revision.previousRevisionId ?? "initial"}</small>
                  </span>
                  <button
                    className="secondary-button compact"
                    disabled={selectedBranch.migrationStatus === "legacy_unverified" || revision.id === selectedBranch.currentRevisionId}
                    onClick={() => restoreRevision(revision.id)}
                  >
                    恢复
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p>暂无版本历史。</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
