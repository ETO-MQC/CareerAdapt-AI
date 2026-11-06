import { z } from "zod";
import { CareerToolGateway, type CareerToolResult } from "./CareerToolGateway";
import { AgentToolRegistry } from "./registry";
import type { AgentToolDefinition } from "../contracts/agentTool";
import { ProfileQueryInputSchema, ProfileSearchQueryInputSchema, ProfileQueryResultSchema,
  type ProfileQueryResult, type ProfileQueryService } from "@/services/profile/profileQueryService";
import { ProfileReadError, type ProfileReadErrorCode } from "@/services/profile/profileReadPort";

const AuthorityContextSchema = z.object({
  workspaceId: z.string().min(1).max(128), personId: z.string().min(1).max(128),
  profileId: z.string().min(1).max(128), sessionId: z.string().min(1).max(128),
  grantId: z.string().min(1).max(128), epoch: z.number().int().min(0),
  leaseExpiry: z.number().finite(), requestId: z.string().min(8).max(128),
  profileVersionNumber: z.number().int().min(1), profileRevision: z.number().int().min(1)
}).strict();
export type ProfileReadAuthorityContext = z.infer<typeof AuthorityContextSchema>;

/** No production issuer is supplied by this slice. The composition root must
 * bind workspaceId to the service's Repository and verify current grant,
 * enabled state, epoch, Session, person and Profile on EVERY verification.
 * Neither this interface nor a renderer object establishes trust on its own.
 */
export interface ProfileReadAuthorityProvider {
  context(): Promise<ProfileReadAuthorityContext>;
  verify(context: Readonly<ProfileReadAuthorityContext>): Promise<boolean>;
}

export type ProfileReadAdapterResult =
  | { ok: true; data: ProfileQueryResult; requestId: string }
  | { ok: false; error: { code: ProfileReadErrorCode }; requestId?: string };

/** Opt-in composition only; intentionally absent from production Host/Plugin.
 * No Dexie, Repository, renderer confirmation or model-selected identity here.
 */
export class ProfileReadAdapter {
  constructor(private readonly service: ProfileQueryService,
    private readonly authority?: ProfileReadAuthorityProvider,
    private readonly now: () => number = Date.now) {}

  async execute(toolName: string, raw: unknown): Promise<ProfileReadAdapterResult> {
    let requestId: string | undefined;
    try {
      if (!this.authority) throw new ProfileReadError("FORBIDDEN");
      if (toolName !== "career.profile.get" && toolName !== "career.profile.search_facts") throw new ProfileReadError("INVALID_REQUEST");
      const contextResult = AuthorityContextSchema.safeParse(await this.authority.context());
      if (!contextResult.success) throw new ProfileReadError("FORBIDDEN");
      const trusted = Object.freeze(contextResult.data);
      requestId = trusted.requestId;
      const verify = async () => trusted.leaseExpiry > this.now() && await this.authority!.verify(trusted);
      if (!await verify()) throw new ProfileReadError("SCOPE_REVOKED");
      const search = toolName === "career.profile.search_facts";
      const schema = search ? ProfileSearchQueryInputSchema : ProfileQueryInputSchema;
      if (!schema.safeParse(raw).success) throw new ProfileReadError("INVALID_REQUEST");
      const tools: AgentToolDefinition[] = [{
        name: search ? "search_profile_facts" : "get_profile", description: "Scoped synthetic Profile read",
        risk: "read", requiresConfirmation: false, idempotent: true, resumable: true,
        category: "profile", dataScope: "profile", producesArtifact: false,
        inputSchema: schema, outputSchema: ProfileQueryResultSchema,
        execute: async input => {
          if (!await verify()) throw new ProfileReadError("SCOPE_REVOKED");
          const result = await this.service.query(trusted, input, trusted.requestId, search);
          if (result.sourceRevision.split(":", 1)[0] !== String(trusted.profileRevision)) throw new ProfileReadError("SCOPE_REVOKED");
          // Discard in-flight results if a grant is revoked while reading.
          if (!await verify()) throw new ProfileReadError("SCOPE_REVOKED");
          return result;
        }
      }];
      // Existing Gateway + Registry classes, scoped per invocation to prevent
      // concurrent requests from sharing mutable authority closures.
      const gateway = new CareerToolGateway({ registry: new AgentToolRegistry(tools),
        verifySessionBinding: async binding => ({ valid:
          binding.personId === trusted.personId && binding.profileId === trusted.profileId
          && binding.agentSessionId === trusted.sessionId && await verify(), code: "SCOPE_REVOKED" }) });
      const result: CareerToolResult<ProfileQueryResult> = await gateway.execute(toolName, raw, {
        operationId: trusted.requestId, agentSessionId: trusted.sessionId, requireSessionBinding: true,
        careerSessionBinding: { personId: trusted.personId, profileId: trusted.profileId,
          agentSessionId: trusted.sessionId, profileVersionNumber: trusted.profileVersionNumber,
          profileRevision: trusted.profileRevision }
      });
      if (!result.ok) {
        const allowed = new Set<ProfileReadErrorCode>(["INVALID_REQUEST", "FORBIDDEN", "NOT_FOUND", "SERVICE_UNAVAILABLE", "SCOPE_REVOKED", "INITIALIZATION_REQUIRED", "STALE_CURSOR"]);
        const code = result.error?.code as ProfileReadErrorCode;
        if (code?.startsWith("career_session_binding_")) throw new ProfileReadError("FORBIDDEN");
        throw new ProfileReadError(allowed.has(code) ? code : "SERVICE_UNAVAILABLE");
      }
      return { ok: true, data: ProfileQueryResultSchema.parse(result.data), requestId };
    } catch (error) {
      // External authority/storage failures never become fixture data or success.
      return { ok: false, error: { code: error instanceof ProfileReadError ? error.code : "SERVICE_UNAVAILABLE" }, requestId };
    }
  }
}
