import { z } from "zod";
import { hashBytes } from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export const AgentAttachmentRefSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().min(0),
  hash: z.string().min(1).optional(),
  /** The Agent Session that selected this file; never infer ownership from a filename. */
  agentSessionId: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export type AgentAttachmentRef = z.infer<typeof AgentAttachmentRefSchema>;

export type AgentAttachmentRegistrationOptions = {
  agentSessionId: string;
};

export class AgentAttachmentStore {
  private readonly files = new Map<string, File>();
  private readonly refs = new Map<string, AgentAttachmentRef>();

  constructor(private readonly repository?: WorkspaceRepository | (() => Promise<WorkspaceRepository>)) {}

  private async persistence() {
    return typeof this.repository === "function" ? this.repository() : this.repository;
  }

  async register(file: File, options?: AgentAttachmentRegistrationOptions): Promise<AgentAttachmentRef> {
    if (file.size > 8 * 1024 * 1024) throw Object.assign(new Error("附件不能超过 8 MB。"), { code: "agent_attachment_too_large" });
    const hash = await hashBytes(new Uint8Array(await file.arrayBuffer()));
    const identityHash = options?.agentSessionId ? await hashBytes(new TextEncoder().encode(`${options.agentSessionId}:${hash}`)) : undefined;
    const stableId = identityHash && /^[a-f0-9]{64}$/u.test(identityHash)
      ? `${identityHash.slice(0, 8)}-${identityHash.slice(8, 12)}-${identityHash.slice(12, 16)}-${identityHash.slice(16, 20)}-${identityHash.slice(20, 32)}`
      : undefined;
    const ref = AgentAttachmentRefSchema.parse({
      id: `agent-attachment-${stableId ?? crypto.randomUUID()}`,
      fileName: file.name,
      mimeType: file.type || mimeTypeFromName(file.name),
      size: file.size,
      hash,
      ...(options?.agentSessionId ? { agentSessionId: options.agentSessionId } : {}),
      createdAt: new Date().toISOString()
    });
    if (this.repository && options?.agentSessionId) {
      await (await this.persistence())!.saveAttachmentSource(ref, new Uint8Array(await file.arrayBuffer()));
    }
    this.files.set(ref.id, file);
    this.refs.set(ref.id, ref);
    return ref;
  }

  async restore(id: string, sessionId?: string) {
    if (!this.has(id) && this.repository) {
      const stored = await (await this.persistence())!.getAttachmentSource(id);
      if (!stored) return this.resolve(id);
      const parsed = z.object({ ref: AgentAttachmentRefSchema, bytes: z.custom<Uint8Array>((value) => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]") }).parse(stored);
      if (sessionId && parsed.ref.agentSessionId !== sessionId) throw ownershipError();
      const ref = parsed.ref;
      const bytes = new Uint8Array(parsed.bytes);
      if (await hashBytes(bytes) !== ref.hash) throw new Error("agent_attachment_hash_mismatch");
      this.refs.set(id, ref);
      this.files.set(id, new File([bytes], ref.fileName, { type: ref.mimeType }));
    }
    const resolved = this.resolve(id);
    if (sessionId && resolved.ref.agentSessionId !== sessionId) throw ownershipError();
    return resolved;
  }

  resolve(id: string) {
    const file = this.files.get(id);
    const ref = this.refs.get(id);
    if (!file || !ref) {
      throw Object.assign(
        new Error("附件内容已失效，请重新选择文件。"),
        { code: "agent_attachment_lost", recovery: "reselect_file" }
      );
    }
    return { ref, file };
  }

  assertOwned(id: string, agentSessionId: string) {
    const { ref } = this.resolve(id);
    if (ref.agentSessionId !== agentSessionId) {
      throw Object.assign(
        new Error("附件不属于当前对话，请重新选择文件。"),
        { code: "agent_attachment_session_mismatch", recovery: "reselect_file" }
      );
    }
    return ref;
  }

  release(id: string) {
    this.files.delete(id);
    this.refs.delete(id);
  }

  releaseMany(ids: readonly string[]) {
    for (const id of ids) this.release(id);
  }

  has(id: string) {
    return this.files.has(id) && this.refs.has(id);
  }

  get activeCount() {
    return this.refs.size;
  }
}

export const agentAttachmentStore = new AgentAttachmentStore(async () => new (await import("@/services/storage/repositories")).WorkspaceRepository());

function ownershipError() {
  return Object.assign(new Error("附件不属于当前对话。"), { code: "agent_attachment_session_mismatch" });
}

function mimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/u.test(lower)) return "image/jpeg";
  return "application/octet-stream";
}
