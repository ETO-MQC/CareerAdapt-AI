import { z } from "zod";
import { hashBytes } from "@/services/security/text";

export const AgentAttachmentRefSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().min(0),
  hash: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export type AgentAttachmentRef = z.infer<typeof AgentAttachmentRefSchema>;

export class AgentAttachmentStore {
  private readonly files = new Map<string, File>();
  private readonly refs = new Map<string, AgentAttachmentRef>();

  async register(file: File): Promise<AgentAttachmentRef> {
    const ref = AgentAttachmentRefSchema.parse({
      id: `agent-attachment-${crypto.randomUUID()}`,
      fileName: file.name,
      mimeType: file.type || mimeTypeFromName(file.name),
      size: file.size,
      hash: await hashBytes(new Uint8Array(await file.arrayBuffer())),
      createdAt: new Date().toISOString()
    });
    this.files.set(ref.id, file);
    this.refs.set(ref.id, ref);
    return ref;
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

  release(id: string) {
    this.files.delete(id);
    this.refs.delete(id);
  }
}

export const agentAttachmentStore = new AgentAttachmentStore();

function mimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
