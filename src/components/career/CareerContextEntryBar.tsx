"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, Download, FileDown, MoreHorizontal, Plus, Settings2, Trash2, Upload } from "lucide-react";
import { countProfileContent, profileCountSummary } from "@/domain/profile/profileCounts";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { useCareerContextStore } from "@/services/career/CareerContextStore";
import { notify } from "@/services/notifications/store";
import { PersonVersionManager } from "@/components/career/PersonVersionManager";

const repository = new WorkspaceRepository();

export type CareerContextEntryBarProps = {
  variant?: "profile" | "resume" | "compact";
  onImport?: () => void;
  onExport?: () => void;
  onNewResume?: () => void;
  onFromCurrentProfile?: () => void;
  onCreateVersion?: () => void;
  onArchiveVersion?: () => void;
  onTrashVersion?: () => void;
};

export function CareerContextEntryBar({ variant = "profile", onImport, onExport, onNewResume, onFromCurrentProfile, onCreateVersion, onArchiveVersion, onTrashVersion }: CareerContextEntryBarProps) {
  const career = useCareerContextStore();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [resumeCount, setResumeCount] = useState(0);
  const profile = career.profiles.find((item) => item.id === career.activeContext?.profileId);
  const person = career.persons.find((item) => item.id === career.activeContext?.personId);
  const profileId = profile?.id;
  const profileVersion = profile?.version;

  useEffect(() => {
    let active = true;
    if (!profileId) return () => { active = false; };
    void repository.listResumeBranches(profileId).then((branches) => {
      if (active) setResumeCount(branches.filter((branch) => branch.lifecycleStatus !== "trashed").length);
    }).catch(() => {
      if (active) setResumeCount(0);
    });
    return () => { active = false; };
  }, [profileId, profileVersion]);

  if (variant === "compact") {
    return <div className="career-context-entry-bar career-context-entry-bar-compact"><button ref={launcherRef} type="button" className="career-context-entry-compact-trigger" onClick={() => setManagerOpen(true)} aria-haspopup="dialog" aria-expanded={managerOpen}><span>{person?.displayName ?? "人物"} · V{profile?.profileVersionNumber ?? 1}</span><ChevronDown aria-hidden="true" /></button><PersonVersionManager open={managerOpen} onClose={() => setManagerOpen(false)} launcherRef={launcherRef} /></div>;
  }

  const counts = profile ? countProfileContent(profile, profileId ? resumeCount : 0) : undefined;
  const createVersion = onCreateVersion ?? (() => {
    if (!profile) {
      setManagerOpen(true);
      return;
    }
    void career.createVersion(profile.id)
      .then(() => notify({ type: "success", title: "版本已创建", message: "新版本已保存，当前人物版本不会自动切换。" }))
      .catch((error) => notify({ type: "error", title: "创建版本失败", message: error instanceof Error ? error.message : "版本创建失败。" }));
  });
  return (
    <section className={`career-context-entry-bar ${variant === "resume" ? "is-resume" : "is-profile"}`} aria-label="当前人物与版本">
      <div className="career-context-entry-identity">
        <div className="career-context-entry-avatar" aria-hidden="true">{person?.displayName.slice(0, 1) ?? "人"}</div>
        <div className="career-context-entry-copy">
          <div className="career-context-entry-name"><strong>{person?.displayName ?? "未选择人物"}</strong>{profile ? <span>V{profile.profileVersionNumber ?? 1}{profile.profileVersionLabel ? ` · ${profile.profileVersionLabel}` : ""}</span> : null}{profile?.id === career.activeContext?.profileId ? <b>当前</b> : null}</div>
          <div className="career-context-entry-meta"><span>创建于 {profile ? formatDate(profile.createdAt) : "—"}</span><span>{counts ? profileCountSummary(counts) : "暂无资料"}</span>{variant === "resume" ? <span>{counts?.resumeCount ?? 0} 份简历</span> : null}</div>
        </div>
      </div>
      <div className="career-context-entry-actions">
        <button ref={launcherRef} type="button" className="secondary-button compact" onClick={() => setManagerOpen(true)} aria-haspopup="dialog" aria-expanded={managerOpen}><Settings2 aria-hidden="true" /> 管理人物与版本</button>
        {variant === "profile" ? <><button type="button" className="secondary-button compact" onClick={onImport}><Download aria-hidden="true" /> 导入资料</button><button type="button" className="secondary-button compact" onClick={onExport}><Upload aria-hidden="true" /> 导出 JSON</button></> : <><button type="button" className="secondary-button compact" onClick={onImport}><FileDown aria-hidden="true" /> 导入简历</button><button type="button" className="primary-button compact" onClick={onNewResume}><Plus aria-hidden="true" /> 新建简历</button><button type="button" className="secondary-button compact" onClick={onFromCurrentProfile}><FileDown aria-hidden="true" /> 从当前资料生成</button></>}
        <details className="career-context-entry-overflow"><summary aria-label="更多人物与版本操作" title="更多人物与版本操作"><MoreHorizontal aria-hidden="true" /></summary><div className="career-context-entry-menu" role="menu"><button type="button" role="menuitem" onClick={createVersion}><Plus aria-hidden="true" /> 新建版本</button><button type="button" role="menuitem" onClick={onArchiveVersion ?? (() => setManagerOpen(true))}><Archive aria-hidden="true" /> 归档版本</button><button type="button" role="menuitem" onClick={onTrashVersion ?? (() => setManagerOpen(true))}><Trash2 aria-hidden="true" /> 删除资料版本</button></div></details>
      </div>
      <PersonVersionManager open={managerOpen} onClose={() => setManagerOpen(false)} launcherRef={launcherRef} />
    </section>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
