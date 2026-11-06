import type { CareerProfile } from "@/domain/schemas/profile";

/** An interface of WorkspaceRepository, not a separate persistence system.
 * Scope must be supplied by the trusted composition root, never model input.
 */
export type ProfileReadScope = { workspaceId: string; personId: string; profileId: string };
export interface ProfileReadPort {
  readInitializedProfile(scope: ProfileReadScope): Promise<CareerProfile>;
}

export type ProfileReadErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE" | "SCOPE_REVOKED" | "INITIALIZATION_REQUIRED" | "STALE_CURSOR";

export class ProfileReadError extends Error {
  constructor(public readonly code: ProfileReadErrorCode) {
    super(code);
  }
}
