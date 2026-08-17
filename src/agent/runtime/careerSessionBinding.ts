import { z } from "zod";

/**
 * Immutable identity carried by every CareerAdapt agent turn.
 *
 * The binding is deliberately separate from page context: page context is
 * presentation state, while this value is the authority boundary used by
 * Hermes and CareerToolGateway.  A page navigation must not be able to
 * replace it implicitly.
 */
export const CareerSessionBindingSchema = z.object({
  personId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersionNumber: z.number().int().min(1),
  profileRevision: z.number().int().min(0),
  agentSessionId: z.string().min(1)
}).strict();

export type CareerSessionBinding = z.infer<typeof CareerSessionBindingSchema>;

type SessionBindingSource = {
  id?: string;
  personId?: string;
  activeProfileId?: string;
  profileVersionNumber?: number;
  profileRevision?: number;
};

type PageBindingSource = {
  agentSessionId?: string;
  personId?: string;
  profileId?: string;
  profileVersionNumber?: number;
  profileRevision?: number;
};

/**
 * Resolve a binding from the persisted session first, then use page context
 * only to detect a visible-context mismatch.  Page context never supplies a
 * missing identity for a session that already exists.
 */
export function resolveCareerSessionBinding(input: {
  sessionId: string;
  session?: SessionBindingSource;
  pageContext?: PageBindingSource;
}): CareerSessionBinding | undefined {
  const session = input.session;
  const values = {
    agentSessionId: session?.id ?? input.pageContext?.agentSessionId,
    personId: session?.personId,
    profileId: session?.activeProfileId,
    profileVersionNumber: session?.profileVersionNumber,
    profileRevision: session?.profileRevision
  };

  if (session) {
    assertOptionalContextMatch(values, input.pageContext);
  } else {
    values.personId = input.pageContext?.personId;
    values.profileId = input.pageContext?.profileId;
    values.profileVersionNumber = input.pageContext?.profileVersionNumber;
    values.profileRevision = input.pageContext?.profileRevision;
  }

  if (values.agentSessionId && values.agentSessionId !== input.sessionId) {
    throw bindingError("career_session_binding_session_mismatch", "Agent Session 与当前运行时会话不一致。");
  }

  if (
    !values.agentSessionId
    || !values.personId
    || !values.profileId
    || values.profileVersionNumber === undefined
    || values.profileRevision === undefined
  ) {
    return undefined;
  }

  return CareerSessionBindingSchema.parse({
    agentSessionId: values.agentSessionId,
    personId: values.personId,
    profileId: values.profileId,
    profileVersionNumber: values.profileVersionNumber,
    profileRevision: values.profileRevision
  });
}

export function assertCareerSessionBinding(value: unknown): CareerSessionBinding {
  return CareerSessionBindingSchema.parse(value);
}

export function sameCareerSessionBinding(left: CareerSessionBinding, right: CareerSessionBinding) {
  return left.personId === right.personId
    && left.profileId === right.profileId
    && left.profileVersionNumber === right.profileVersionNumber
    && left.profileRevision === right.profileRevision
    && left.agentSessionId === right.agentSessionId;
}

function assertOptionalContextMatch(
  binding: {
    agentSessionId?: string;
    personId?: string;
    profileId?: string;
    profileVersionNumber?: number;
    profileRevision?: number;
  },
  pageContext?: PageBindingSource
) {
  if (!pageContext) return;
  const pairs: Array<[string, unknown, unknown]> = [
    ["agentSessionId", pageContext.agentSessionId, binding.agentSessionId],
    ["personId", pageContext.personId, binding.personId],
    ["profileId", pageContext.profileId, binding.profileId],
    ["profileVersionNumber", pageContext.profileVersionNumber, binding.profileVersionNumber],
    ["profileRevision", pageContext.profileRevision, binding.profileRevision]
  ];
  const mismatch = pairs.find(([, pageValue, sessionValue]) =>
    pageValue !== undefined && sessionValue !== undefined && pageValue !== sessionValue
  );
  if (mismatch) {
    throw bindingError(
      "career_session_binding_context_mismatch",
      `页面上下文不能替换已固定的 Agent Session（${mismatch[0]}）。`
    );
  }
}

function bindingError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
