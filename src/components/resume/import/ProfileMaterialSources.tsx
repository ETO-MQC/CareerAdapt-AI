"use client";
import { useEffect, useState } from "react";
import type { MaterialIntakeArtifact } from "@/domain/materialIntake/materialIntake";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { MaterialSourceReview } from "./MaterialSourceReview";

export function ProfileMaterialSources({ profileId, profileVersion, itemId, repository }: {
  profileId: string; profileVersion: number; itemId: string; repository: WorkspaceRepository;
}) {
  const [sources, setSources] = useState<MaterialIntakeArtifact[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void repository.getProfileMaterialSources(profileId, itemId).then((value) => { if (active) setSources(value); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "来源读取失败。"); });
    return () => { active = false; };
  }, [profileId, profileVersion, itemId, repository]);
  return <div aria-label="已确认事实的材料来源">{error ? <p role="alert">{error}</p> : null}
    {sources.map((source) => <MaterialSourceReview key={`${source.importId}:${source.sessionId}:${source.attachmentId}`} artifact={source} repository={repository} />)}
  </div>;
}
