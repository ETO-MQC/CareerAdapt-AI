"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { ActiveCareerContext, CareerPerson, CareerProfile } from "@/domain/schemas";
import { countProfileContent, profileCountSummary } from "@/domain/profile/profileCounts";
import { useCareerContextStore } from "@/services/career/CareerContextStore";
import { notify } from "@/services/notifications/store";

type ManagerTab = "create" | "all" | "alphabet" | "versions" | "archived" | "trash";
type DialogState = "rename" | "archive" | "trash" | "permanent" | undefined;

export type PersonVersionManagerProps = {
  open: boolean;
  onClose: () => void;
  launcherRef?: RefObject<HTMLElement | null>;
  onBeforeSelect?: (context: ActiveCareerContext) => Promise<boolean | void> | boolean | void;
};

export type CareerContextSelection = ActiveCareerContext;

export function PersonVersionManager({ open, onClose, launcherRef, onBeforeSelect }: PersonVersionManagerProps) {
  const career = useCareerContextStore();
  const dialogRef = useRef<HTMLElement>(null);
  const dialogStateRef = useRef<DialogState>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<ManagerTab>("all");
  const [search, setSearch] = useState("");
  const [versionFilter, setVersionFilter] = useState<"all" | "current" | "active" | "archived" | "trash">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogState>();
  const [renameText, setRenameText] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [busy, setBusy] = useState(false);
  dialogStateRef.current = dialog;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activePersonId = career.activeContext?.personId ?? career.persons[0]?.id;
    const activeProfileId = career.activeContext?.profileId ?? career.profiles.find((profile) => profile.personId === activePersonId)?.id;
    career.selectManagerItem(career.selectedPersonId ?? activePersonId, career.selectedProfileId ?? activeProfileId);
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dialogStateRef.current) {
          setDialog(undefined);
          setConfirmText("");
        } else {
          closeManager();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // The modal owns the key handler for its open lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function closeManager() {
    onClose();
    window.requestAnimationFrame(() => (launcherRef?.current ?? previousFocusRef.current)?.focus());
  }

  const profilesByPerson = useMemo(() => {
    const result = new Map<string, CareerProfile[]>();
    for (const person of career.persons) result.set(person.id, []);
    for (const profile of career.profiles) {
      if (!profile.personId) continue;
      result.set(profile.personId, [...(result.get(profile.personId) ?? []), profile]);
    }
    for (const [personId, profiles] of result) {
      result.set(personId, [...profiles].sort((left, right) => (left.profileVersionNumber ?? 1) - (right.profileVersionNumber ?? 1)));
    }
    return result;
  }, [career.persons, career.profiles]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of career.persons) counts.set(person.displayName, (counts.get(person.displayName) ?? 0) + 1);
    return counts;
  }, [career.persons]);

  const personLabel = useCallback((person: CareerPerson) => {
    if ((duplicateNames.get(person.displayName) ?? 0) < 2) return person.displayName;
    const sameName = career.persons.filter((candidate) => candidate.displayName === person.displayName).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return `${person.displayName} · 人物 ${sameName.findIndex((candidate) => candidate.id === person.id) + 1}`;
  }, [career.persons, duplicateNames]);

  const filteredPersons = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matchesProfile = (profile: CareerProfile) => {
      if (versionFilter === "current") return Boolean(profile.isCurrent);
      if (versionFilter === "active") return !profile.archivedAt && !profile.trashedAt;
      if (versionFilter === "archived") return Boolean(profile.archivedAt) && !profile.trashedAt;
      if (versionFilter === "trash") return Boolean(profile.trashedAt);
      return true;
    };
    return [...career.persons]
      .filter((person) => {
        const profiles = profilesByPerson.get(person.id) ?? [];
        if (tab === "archived" && !profiles.some((profile) => profile.archivedAt && !profile.trashedAt)) return false;
        if (tab === "trash" && !person.trashedAt && !profiles.some((profile) => profile.trashedAt)) return false;
        if (query && !person.displayName.toLocaleLowerCase().includes(query) && !profiles.some((profile) => `${profile.profileVersionLabel ?? ""} V${profile.profileVersionNumber ?? 1}`.toLocaleLowerCase().includes(query))) return false;
        return profiles.some(matchesProfile) || Boolean(person.trashedAt && (tab === "trash" || versionFilter === "trash"));
      })
      .sort((left, right) => {
        if (tab === "alphabet") return personLabel(left).localeCompare(personLabel(right), "zh-CN");
        return left.createdAt.localeCompare(right.createdAt);
      });
  }, [career.persons, profilesByPerson, search, tab, versionFilter, personLabel]);

  const selectedPerson = career.persons.find((person) => person.id === career.selectedPersonId) ?? filteredPersons[0];
  const selectedProfile = career.profiles.find((profile) => profile.id === career.selectedProfileId && profile.personId === selectedPerson?.id)
    ?? (selectedPerson ? profilesByPerson.get(selectedPerson.id)?.[0] : undefined);
  const activeProfile = career.profiles.find((profile) => profile.id === career.activeContext?.profileId);
  const selectedCounts = selectedProfile ? countProfileContent(selectedProfile) : undefined;

  function selectProfile(person: CareerPerson, profile: CareerProfile) {
    career.selectManagerItem(person.id, profile.id);
  }

  async function handleUseSelectedVersion() {
    if (!selectedPerson || !selectedProfile || !selectedProfile.personId) return;
    setBusy(true);
    try {
      const nextContext = toContext(selectedPerson, selectedProfile);
      const allowed = await onBeforeSelect?.(nextContext);
      if (allowed === false) return;
      await career.selectContext({ personId: selectedPerson.id, profileId: selectedProfile.id });
      notify({ type: "success", title: "已使用此版本", message: `当前人物版本已切换为 ${personLabel(selectedPerson)} · ${versionLabel(selectedProfile)}。` });
      closeManager();
    } catch (error) {
      notify({ type: "error", title: "切换失败", message: error instanceof Error ? error.message : "当前版本无法切换。" });
    } finally {
      setBusy(false);
    }
  }

  async function createPerson() {
    if (!newPersonName.trim()) return;
    setBusy(true);
    try {
      await career.createPerson(newPersonName.trim());
      setNewPersonName("");
      setTab("all");
      notify({ type: "success", title: "人物已创建", message: "新人物和 V1 已保存到本地。" });
    } catch (error) {
      notify({ type: "error", title: "创建失败", message: error instanceof Error ? error.message : "人物创建失败。" });
    } finally {
      setBusy(false);
    }
  }

  async function createVersion() {
    if (!selectedProfile) return;
    setBusy(true);
    try {
      await career.createVersion(selectedProfile.id);
      notify({ type: "success", title: "版本已创建", message: "新版本已保存，当前选择仅供检查；请点击“使用此版本”切换。" });
    } catch (error) {
      notify({ type: "error", title: "创建版本失败", message: error instanceof Error ? error.message : "版本创建失败。" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!selectedProfile) return;
    if (dialog === "rename") {
      setBusy(true);
      try {
        await career.rename(selectedProfile.id, renameText.trim());
        setDialog(undefined);
        notify({ type: "success", title: "版本已重命名", message: "版本名称已保存。" });
      } catch (error) {
        notify({ type: "error", title: "重命名失败", message: error instanceof Error ? error.message : "版本名称保存失败。" });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (dialog === "permanent" && confirmText !== "永久删除") return;
    setBusy(true);
    try {
      if (dialog === "archive") await career.archive({ profileId: selectedProfile.id, expectedRevision: selectedProfile.version, operationId: crypto.randomUUID() });
      if (dialog === "trash") await career.trash({ profileId: selectedProfile.id, expectedRevision: selectedProfile.version, operationId: crypto.randomUUID() });
      if (dialog === "permanent") {
        const result = await career.permanentlyDelete({ profileId: selectedProfile.id, expectedRevision: selectedProfile.version, operationId: crypto.randomUUID() });
        if ("deleted" in result && !result.deleted) {
          notify({ type: "warning", title: "仍有引用阻止删除", message: formatBlockers(result.blockers) });
        }
      }
      setDialog(undefined);
      setConfirmText("");
    } catch (error) {
      notify({ type: "error", title: "操作未完成", message: lifecycleErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="person-version-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManager(); }}>
      <section
        className={`person-version-manager ${tab === "create" ? "is-creating" : ""}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-version-manager-title"
        tabIndex={-1}
      >
        <header className="person-version-manager-header">
          <div>
            <p className="person-version-manager-eyebrow">CareerAdapt / Identity</p>
            <h2 id="person-version-manager-title">人物与版本</h2>
            <p>检查人物资料和版本历史；只有确认使用后才会切换当前工作上下文。</p>
          </div>
          <button type="button" className="person-version-manager-close" aria-label="关闭人物与版本选择器" onClick={closeManager}>
            <X aria-hidden="true" />
          </button>
        </header>

        <nav className="person-version-manager-tabs" aria-label="人物与版本管理方式">
          <ManagerTabButton active={tab === "create"} onClick={() => setTab("create")} label="新增人物" icon={<Plus aria-hidden="true" />} />
          <ManagerTabButton active={tab === "all"} onClick={() => setTab("all")} label="全部人物" />
          <ManagerTabButton active={tab === "alphabet"} onClick={() => setTab("alphabet")} label="按首字母排序" />
          <ManagerTabButton active={tab === "versions"} onClick={() => setTab("versions")} label="版本筛选" />
          <ManagerTabButton active={tab === "archived"} onClick={() => { setVersionFilter("archived"); setTab("archived"); }} label="旧档版本" />
          <ManagerTabButton active={tab === "trash"} onClick={() => { setVersionFilter("trash"); setTab("trash"); }} label="回收站" />
        </nav>

        {tab === "create" ? (
          <section className="person-version-manager-create-panel" aria-label="新增人物">
            <h3>新增人物</h3>
            <p>创建一个独立的人物容器和初始 V1。人物之间的资料和简历不会互相串联。</p>
            <form onSubmit={(event) => { event.preventDefault(); void createPerson(); }}>
              <label htmlFor="person-version-new-person">人物名称</label>
              <div className="person-version-manager-create-row">
                <input id="person-version-new-person" name="person-name" autoComplete="name" value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="输入人物名称" />
                <button className="product-button" data-variant="primary" type="submit" disabled={busy || !newPersonName.trim()}><Plus aria-hidden="true" /> 创建人物</button>
              </div>
            </form>
          </section>
        ) : null}

        <div className="person-version-manager-body">
          <aside className="person-version-manager-sidebar" aria-label="人物和版本列表">
            <div className="person-version-manager-search-row">
              <label className="person-version-manager-search">
                <Search aria-hidden="true" />
                <span className="sr-only">搜索人物或版本</span>
                <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索人物或版本" aria-label="搜索人物或版本" />
              </label>
              <button type="button" className="product-icon-button" aria-label="筛选版本" title="筛选版本" onClick={() => setTab("versions")}><Filter aria-hidden="true" /></button>
            </div>
            {tab === "versions" ? (
              <label className="person-version-filter-select">
                <span>版本状态</span>
                <select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value as typeof versionFilter)}>
                  <option value="all">全部版本</option>
                  <option value="current">当前版本</option>
                  <option value="active">可用版本</option>
                  <option value="archived">已归档</option>
                  <option value="trash">回收站</option>
                </select>
              </label>
            ) : null}
            <div className="person-version-manager-list" role="listbox" aria-label="人物版本">
              {filteredPersons.map((person) => {
                const personProfiles = (profilesByPerson.get(person.id) ?? []).filter((profile) => {
                  if (versionFilter === "current") return Boolean(profile.isCurrent);
                  if (versionFilter === "active") return !profile.archivedAt && !profile.trashedAt;
                  if (versionFilter === "archived") return Boolean(profile.archivedAt) && !profile.trashedAt;
                  if (versionFilter === "trash") return Boolean(profile.trashedAt);
                  return true;
                });
                const isExpanded = expanded[person.id] ?? true;
                return (
                  <div key={person.id} className={`person-version-manager-person ${person.id === career.selectedPersonId ? "is-selected" : ""}`}>
                    <button type="button" className="person-version-manager-person-row" onClick={() => { career.selectManagerItem(person.id, personProfiles[0]?.id); setExpanded((current) => ({ ...current, [person.id]: !isExpanded })); }} aria-expanded={isExpanded}>
                      {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                      <span className="person-version-manager-person-copy"><strong>{personLabel(person)}</strong><small>{personProfiles.length} 个版本 · {formatDate(person.createdAt)}</small></span>
                      <LifecycleBadge lifecycle={personLifecycle(person)} />
                    </button>
                    {isExpanded ? personProfiles.map((profile) => (
                      <VersionListItem
                        key={profile.id}
                        person={person}
                        profile={profile}
                        selected={profile.id === career.selectedProfileId}
                        active={profile.id === career.activeContext?.profileId}
                        onSelect={() => selectProfile(person, profile)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                          const items = Array.from(event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>(".person-version-manager-version-row") ?? []);
                          const index = items.indexOf(event.currentTarget);
                          const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
                          if (next) { event.preventDefault(); next.focus(); next.click(); }
                        }}
                      />
                    )) : null}
                  </div>
                );
              })}
              {filteredPersons.length === 0 ? <p className="person-version-manager-empty">没有匹配的人物或版本。</p> : null}
            </div>
          </aside>

          <section className="person-version-manager-detail" aria-label="版本详情">
            {selectedPerson && selectedProfile ? (
              <>
                <div className="person-version-detail-heading">
                  <div>
                    <p className="person-version-detail-kicker">{personLabel(selectedPerson)}</p>
                    <h3>{selectedProfile.name} <span>{versionLabel(selectedProfile)}</span></h3>
                    <div className="person-version-detail-badges"><LifecycleBadge lifecycle={profileLifecycle(selectedProfile)} />{selectedProfile.id === career.activeContext?.profileId ? <span className="person-version-current-badge" aria-current="true"><Check aria-hidden="true" /> 当前使用</span> : null}</div>
                  </div>
                  <button type="button" className="product-button" data-variant="primary" disabled={busy || Boolean(selectedProfile.trashedAt) || Boolean(selectedProfile.archivedAt)} onClick={() => void handleUseSelectedVersion()}>使用此版本</button>
                </div>
                <div className="person-version-detail-meta">
                  <MetaCell label="创建日期" value={formatDate(selectedProfile.createdAt)} />
                  <MetaCell label="最近更新" value={formatDate(selectedProfile.updatedAt)} />
                  <MetaCell label="创建原因" value={versionReasonLabel(selectedProfile.versionCreatedReason)} />
                  <MetaCell label="信息概览" value={selectedCounts ? profileCountSummary(selectedCounts) : "—"} />
                </div>
                <section className="person-version-overview" aria-labelledby="person-version-overview-title">
                  <div className="person-version-section-heading"><div><h4 id="person-version-overview-title">资料内容概览</h4><p>仅显示已保存的结构化数量，不把未确认内容写入当前资料。</p></div><MoreHorizontal aria-hidden="true" /></div>
                  <div className="person-version-count-grid">
                    <CountCell label="基础信息" value={selectedCounts?.basicFieldCount ?? 0} />
                    <CountCell label="经历条目" value={selectedCounts?.careerItemCount ?? 0} />
                    <CountCell label="已确认事实" value={selectedCounts?.confirmedFactCount ?? 0} />
                    <CountCell label="关联简历" value={selectedCounts?.resumeCount ?? 0} />
                  </div>
                </section>
                <section className="person-version-timeline" aria-labelledby="person-version-timeline-title">
                  <div className="person-version-section-heading"><h4 id="person-version-timeline-title">版本时间线</h4><span>V{selectedProfile.profileVersionNumber ?? 1}</span></div>
                  <ol><li><span className="timeline-dot" /><div><strong>{versionLabel(selectedProfile)} 已创建</strong><small>{formatDate(selectedProfile.createdAt)} · {versionReasonLabel(selectedProfile.versionCreatedReason)} · 本地创建</small></div></li><li><span className="timeline-dot" /><div><strong>最近一次更新</strong><small>{formatDate(selectedProfile.updatedAt)} · 本地更新</small></div></li></ol>
                </section>
                <div className="person-version-detail-actions">
                  <button type="button" className="secondary-button compact" disabled={busy || Boolean(selectedProfile.trashedAt)} onClick={() => void createVersion()}><Plus aria-hidden="true" /> 新建版本</button>
                  <button type="button" className="secondary-button compact" disabled={busy || Boolean(selectedProfile.trashedAt)} onClick={() => { setRenameText(selectedProfile.profileVersionLabel ?? ""); setDialog("rename"); }}><Pencil aria-hidden="true" /> 重命名</button>
                  {!selectedProfile.archivedAt && !selectedProfile.trashedAt ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => setDialog("archive")}><Archive aria-hidden="true" /> 归档</button> : null}
                  {selectedProfile.archivedAt && !selectedProfile.trashedAt ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { void career.restore({ profileId: selectedProfile.id, expectedRevision: selectedProfile.version, operationId: crypto.randomUUID() }); }}><RotateCcw aria-hidden="true" /> 恢复归档</button> : null}
                  {!selectedProfile.trashedAt ? <button type="button" className="danger-button compact" disabled={busy} onClick={() => setDialog("trash")}><Trash2 aria-hidden="true" /> 移入回收站</button> : null}
                  {selectedProfile.trashedAt ? <><button type="button" className="secondary-button compact" disabled={busy} onClick={() => { void career.restore({ profileId: selectedProfile.id, expectedRevision: selectedProfile.version, operationId: crypto.randomUUID(), fromTrash: true }); }}><RotateCcw aria-hidden="true" /> 恢复</button><button type="button" className="danger-button compact" disabled={busy} onClick={() => { setConfirmText(""); setDialog("permanent"); }}><Trash2 aria-hidden="true" /> 永久删除</button></> : null}
                  <button type="button" className="product-icon-button" aria-label="更多版本操作" title="更多版本操作"><MoreHorizontal aria-hidden="true" /></button>
                </div>
                {activeProfile && activeProfile.id !== selectedProfile.id ? <p className="person-version-inspection-note">当前使用的是 {versionLabel(activeProfile)}；左侧点击仅检查版本，不会切换当前上下文。</p> : null}
              </>
            ) : <div className="person-version-manager-empty detail-empty"><h3>选择一个版本</h3><p>从左侧人物列表选择版本查看详细信息。</p></div>}
          </section>
        </div>
        {dialog ? <ManagerConfirmDialog dialog={dialog} renameText={renameText} confirmText={confirmText} busy={busy} onRenameText={setRenameText} onConfirmText={setConfirmText} onCancel={() => { setDialog(undefined); setConfirmText(""); }} onConfirm={() => void confirmAction()} /> : null}
      </section>
    </div>
  );
}

export function CareerContextSelector({ className = "", onBeforeSelect }: { className?: string; onBeforeSelect?: PersonVersionManagerProps["onBeforeSelect"] }) {
  const career = useCareerContextStore();
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const activePerson = career.persons.find((person) => person.id === career.activeContext?.personId);
  const activeProfile = career.profiles.find((profile) => profile.id === career.activeContext?.profileId);
  const counts = activeProfile ? countProfileContent(activeProfile) : undefined;
  return (
    <div className={`career-context-selector ${className}`}>
      <button ref={launcherRef} type="button" className="career-context-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="career-context-trigger-copy"><strong>{activePerson && activeProfile ? `${activePerson.displayName} · ${versionLabel(activeProfile)}` : "选择人物与版本"}</strong><small>{activeProfile ? `${profileCountSummary(counts!)} · 创建于 ${formatDate(activeProfile.createdAt)}` : "没有默认人物；请选择后继续"}</small></span><ChevronDown aria-hidden="true" />
      </button>
      <PersonVersionManager open={open} onClose={() => setOpen(false)} launcherRef={launcherRef} onBeforeSelect={onBeforeSelect} />
    </div>
  );
}

function VersionListItem({ person, profile, selected, active, onSelect, onKeyDown }: { person: CareerPerson; profile: CareerProfile; selected: boolean; active: boolean; onSelect: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void }) {
  const counts = countProfileContent(profile);
  return <button type="button" role="option" aria-selected={selected} aria-current={active ? "true" : undefined} className={`person-version-manager-version-row ${selected ? "is-selected" : ""} ${active ? "is-active" : ""}`} onClick={onSelect} onKeyDown={onKeyDown}><span className="person-version-manager-version-marker" /><span className="person-version-manager-version-copy"><strong>{versionLabel(profile)}{profile.profileVersionLabel ? ` · ${profile.profileVersionLabel}` : ""}</strong><small>{profileCountSummary(counts)} · {formatDate(profile.createdAt)}</small></span><LifecycleBadge lifecycle={profileLifecycle(profile)} />{active ? <Check aria-label="当前使用" /> : null}<span className="sr-only">{person.displayName}</span></button>;
}

function ManagerTabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon?: React.ReactNode; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={`person-version-manager-tab ${active ? "is-active" : ""}`} onClick={onClick}>{icon}{label}</button>;
}

function LifecycleBadge({ lifecycle }: { lifecycle: "active" | "archived" | "trashed" }) {
  const label = lifecycle === "active" ? "可用" : lifecycle === "archived" ? "旧档" : "回收站";
  return <span className={`person-version-lifecycle-badge is-${lifecycle}`}>{label}</span>;
}

function MetaCell({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function CountCell({ label, value }: { label: string; value: number }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function ManagerConfirmDialog({ dialog, renameText, confirmText, busy, onRenameText, onConfirmText, onCancel, onConfirm }: { dialog: Exclude<DialogState, undefined>; renameText: string; confirmText: string; busy: boolean; onRenameText: (value: string) => void; onConfirmText: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const isRename = dialog === "rename";
  const isPermanent = dialog === "permanent";
  const title = isRename ? "重命名版本" : dialog === "archive" ? "归档版本" : dialog === "trash" ? "移入回收站" : "永久删除版本";
  const description = isRename ? "版本名称仅用于识别，不会改变资料内容。" : isPermanent ? "永久删除不可恢复，并且只会在没有引用阻塞时执行。" : dialog === "trash" ? "移入回收站后不会出现在可用版本中。" : "归档后仍可恢复，且不会作为当前可用版本。";
  return <div className="career-action-dialog-backdrop" role="presentation"><section className="career-action-dialog" role="dialog" aria-modal="true" aria-labelledby="career-action-dialog-title"><h3 id="career-action-dialog-title">{title}</h3><p>{description}</p>{isRename ? <label>版本名称<input autoFocus value={renameText} onChange={(event) => onRenameText(event.target.value)} name="version-label" /></label> : null}{isPermanent ? <label>输入“永久删除”确认<input autoFocus value={confirmText} onChange={(event) => onConfirmText(event.target.value)} name="permanent-delete-confirmation" /></label> : null}<div className="career-action-dialog-actions"><button type="button" className="secondary-button compact" onClick={onCancel}>取消</button><button type="button" className={isPermanent || dialog === "trash" ? "danger-button compact" : "primary-button compact"} disabled={busy || (isPermanent && confirmText !== "永久删除")} onClick={onConfirm}>{isRename ? "保存名称" : isPermanent ? "永久删除" : "确认"}</button></div></section></div>;
}

function toContext(person: CareerPerson, profile: CareerProfile): ActiveCareerContext { return { schemaVersion: "active-career-v1", personId: person.id, profileId: profile.id, profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version, selectedAt: new Date().toISOString() }; }
function versionLabel(profile: CareerProfile) { return `V${profile.profileVersionNumber ?? 1}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function profileLifecycle(profile: CareerProfile): "active" | "archived" | "trashed" { return profile.trashedAt ? "trashed" : profile.archivedAt ? "archived" : "active"; }
function personLifecycle(person: CareerPerson): "active" | "archived" | "trashed" { return person.trashedAt ? "trashed" : person.archivedAt ? "archived" : "active"; }
function versionReasonLabel(reason: CareerProfile["versionCreatedReason"]) { return reason === "resume_import" ? "简历导入" : reason === "agent_created" ? "AI 工作区创建" : reason === "conflict_fork" ? "冲突分支" : reason === "manual_snapshot" ? "手动快照" : "初始版本"; }
function lifecycleErrorMessage(error: unknown) { const code = error instanceof Error ? error.message : "unknown"; return code === "career_profile_current_cannot_trash" ? "当前版本不能直接移入回收站，请先使用另一个有效版本。" : code === "career_profile_current_cannot_archive" ? "当前版本不能直接归档，请先保留另一个有效版本。" : code === "career_profile_not_in_trash" ? "版本尚未在回收站中。" : code; }
function formatBlockers(blockers: Record<string, number>) { return Object.entries(blockers).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(" · ") || "请刷新后重试。"; }
