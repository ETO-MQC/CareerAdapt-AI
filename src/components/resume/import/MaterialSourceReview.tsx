"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { MaterialIntakeArtifact } from "@/domain/materialIntake/materialIntake";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import type { ResumeSourceDocumentV2 } from "@/domain/schemas";
import { AgentAttachmentStore } from "@/services/agent/AgentAttachmentStore";

/** A read-only view of persisted source bytes and blocks, never the edited draft. */
export function MaterialSourceReview({ artifact, repository, blockIds = [] }: {
  artifact: MaterialIntakeArtifact; repository: WorkspaceRepository; blockIds?: string[];
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [recognition, setRecognition] = useState<ResumeSourceDocumentV2>();
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void new AgentAttachmentStore(repository).restore(artifact.attachmentId, artifact.sessionId).then(({ file }) => {
      if (active) { objectUrl = URL.createObjectURL(file); setUrl(objectUrl); }
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "原附件读取失败"); });
    void repository.getMeta(`material-recognition:${artifact.sessionId}:${artifact.attachmentId}`).then((row) => {
      if (active && row) setRecognition(row.value as ResumeSourceDocumentV2);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "识别记录读取失败"); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifact.attachmentId, artifact.sessionId, repository]);
  const blocks = [...artifact.sourceDocument.blocks].sort((a, b) => a.order - b.order);
  return <details open className="material-source-review">
    <summary>原始材料与来源：{artifact.fileName}</summary>
    <p>SHA-256：<code style={{ overflowWrap: "anywhere" }}>{artifact.hash}</code></p>
    <p>分类：{artifact.classification?.materialKind ?? "UNKNOWN / REVIEW_REQUIRED"} · 用途：{artifact.purpose === "profile_material" ? "补充个人资料" : artifact.purpose ?? "待选择"}</p>
    {error ? <p role="alert">{error}</p> : null}
    {url ? <>
      <a href={url} download={artifact.fileName}>查看 / 下载原附件</a>
      {artifact.mimeType.startsWith("image/") ? <div style={{ position: "relative" }}>
        <Image src={url} alt={`原始材料 ${artifact.fileName}`} width={size.width} height={size.height} unoptimized
          style={{ width: "100%", height: "auto" }} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        <svg aria-label="来源区域" viewBox={`0 0 ${size.width} ${size.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {blocks.filter((block) => block.position && (!blockIds.length || blockIds.includes(block.id))).map((block) => <rect key={block.id} {...block.position} fill="none" stroke="#a65316" strokeWidth="2"><title>{block.rawText}</title></rect>)}
        </svg>
      </div> : artifact.mimeType === "application/pdf" ? <iframe title={`原始材料 ${artifact.fileName}`} src={url} style={{ width: "100%", height: 360 }} /> : null}
    </> : null}
    <p>识别置信度只描述识别结果，不代表事实真实性。人工修改保存在候选中。</p>
    {recognition ? <details><summary>人工转写前的原始识别记录</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(recognition, null, 2)}</pre></details> : null}
    {blocks.map((block) => <details key={block.id} open={blockIds.includes(block.id)}>
      <summary>第 {block.page ?? 1} 页 · 来源块 {block.order + 1} · {block.sourceEngine} · {Math.round(block.extractionConfidence * 100)}%</summary>
      <p>{block.id} · {block.position ? `区域 x=${block.position.x}, y=${block.position.y}, w=${block.position.width}, h=${block.position.height}` : "仅有页级定位（无 bbox）"}</p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{block.rawText}</pre>
      <details><summary>SourceDocument 原始来源块</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(block, null, 2)}</pre></details>
    </details>)}
    {!blocks.length ? <p>尚无可辨认文字，请对照原件人工转写或重试 OCR。</p> : null}
  </details>;
}
