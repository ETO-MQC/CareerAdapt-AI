import { z } from "zod";

/**
 * The model-facing Career tool contract is versioned independently from the
 * product phase.  Bumping this value is required whenever a published tool
 * schema changes so a stale Hermes tool surface cannot report Ready.
 */
export const CAREER_TOOL_CONTRACT_VERSION = "career-tool-contract-v2";

const CAREER_TARGET_PERSISTENCE_VALUES = ["ask", "save", "session_only"] as const;

export const TailorResumeUserAnswerSchema = z.union([
  z.string().trim().min(1).max(8_000),
  z.array(z.string().trim().min(1)).min(1).max(32),
  z.boolean()
]);

const TailorResumePastedStartSchema = z.object({
  profileId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  targetText: z.string().trim().min(20).max(24_000),
  jobPersistence: z.enum(CAREER_TARGET_PERSISTENCE_VALUES).optional().default("ask"),
  /** Optional metadata retained for legacy structured-target callers. */
  targetTitle: z.string().trim().min(1).max(160).optional(),
  targetCompany: z.string().trim().min(1).max(160).optional(),
  targetSourceUrl: z.string().url().optional()
}).strict();

const TailorResumeSavedJobStartSchema = z.object({
  profileId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  jobId: z.string().min(1)
}).strict();

const TailorResumeContinueSchema = z.object({
  checkpointId: z.string().min(1),
  userAnswer: TailorResumeUserAnswerSchema.optional()
}).strict();

/**
 * Canonical model-facing union:
 * - pasted external JD START: targetText
 * - saved Job START: jobId
 * - CONTINUE: checkpointId and, when needed, userAnswer
 *
 * The union intentionally does not publish internal target snapshots,
 * tailoring sessions, workflow stages, or persistence structures.
 */
export const TailorResumeInputSchema = z.union([
  TailorResumePastedStartSchema,
  TailorResumeSavedJobStartSchema,
  TailorResumeContinueSchema
]);

export type TailorResumeInput = z.infer<typeof TailorResumeInputSchema>;

export type CareerContractIdentity = {
  contractVersion: string;
  contractSchemaHash: string;
};

export type CareerContractConsistency = {
  ready: boolean;
  reason?: "career_tool_contract_mismatch";
  contractVersion: string;
  mismatches: Array<{
    toolName: string;
    reason: "missing" | "version" | "hash" | "canonical_schema";
    publishedContractVersion?: string;
    publishedSchemaHash?: string;
    expectedSchemaHash?: string;
  }>;
};

export function normalizeTailorResumeInput(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return rawInput;
  const input = { ...(rawInput as Record<string, unknown>) };

  // Documented pre-canonical aliases.  They are normalized here, once, at
  // the Facade boundary; the published schema never exposes them.
  if (input.resumeId !== undefined && typeof input.resumeId !== "string") return input;
  if (input.sourceResumeId === undefined && typeof input.resumeId === "string") {
    input.sourceResumeId = input.resumeId;
  }
  delete input.resumeId;

  if (input.saveTargetPreference !== undefined) {
    const persistence = normalizePersistenceAlias(input.saveTargetPreference, true);
    if (!persistence) return input;
    if (input.jobPersistence === undefined) input.jobPersistence = persistence;
  }
  delete input.saveTargetPreference;

  const legacyTarget = input.target;
  if (typeof legacyTarget === "string") {
    if (input.targetText === undefined) {
      input.targetText = legacyTarget;
      delete input.target;
    } else if (input.targetText === legacyTarget) {
      delete input.target;
    }
    return input;
  }

  if (!legacyTarget || typeof legacyTarget !== "object" || Array.isArray(legacyTarget)) return input;
  const target = legacyTarget as Record<string, unknown>;
  if (target.type === "saved_job"
    && hasOnlyKeys(target, ["type", "jobId"])
    && typeof target.jobId === "string"
    && target.jobId.length > 0) {
    if (input.jobId === undefined || input.jobId === target.jobId) {
      input.jobId ??= target.jobId;
      delete input.target;
    }
    return input;
  }

  if (target.type === "pasted_jd"
    && hasOnlyKeys(target, ["type", "text", "title", "company", "sourceUrl", "persistence"])
    && typeof target.text === "string") {
    if (input.targetText !== undefined && input.targetText !== target.text) return input;
    input.targetText ??= target.text;
    if (input.jobPersistence === undefined && target.persistence !== undefined) {
      const persistence = normalizePersistenceAlias(target.persistence, false);
      if (!persistence) return input;
      input.jobPersistence = persistence;
    }
    if (input.targetTitle === undefined && typeof target.title === "string") input.targetTitle = target.title;
    if (input.targetCompany === undefined && typeof target.company === "string") input.targetCompany = target.company;
    if (input.targetSourceUrl === undefined && typeof target.sourceUrl === "string") input.targetSourceUrl = target.sourceUrl;
    delete input.target;
  }
  return input;
}

export function canonicalTailorResumeRepresentativeInput(): TailorResumeInput {
  return TailorResumeInputSchema.parse({
    profileId: "contract-profile",
    sourceResumeId: "contract-resume",
    targetText: "A representative external job description with enough detail."
  });
}

export function contractIdentityForInputSchema(inputSchema: Record<string, unknown>): CareerContractIdentity {
  return {
    contractVersion: CAREER_TOOL_CONTRACT_VERSION,
    contractSchemaHash: contractSchemaHash(inputSchema)
  };
}

export function contractSchemaHash(inputSchema: Record<string, unknown>) {
  return `fnv1a-${fnv1a(stableJson(inputSchema))}`;
}

export function stableCareerLogicalToolOperationId(logicalTurnId: string | undefined, toolName: string) {
  return `career-logical-${fnv1a(`${logicalTurnId ?? "no-turn"}:${toolName}`)}`;
}

export function canonicalTailorResumeContractIdentity(): CareerContractIdentity {
  return contractIdentityForInputSchema(tailorResumeInputJsonSchema());
}

export function tailorResumeInputJsonSchema() {
  return z.toJSONSchema(TailorResumeInputSchema) as Record<string, unknown>;
}

export function evaluateCareerToolContractSurface(
  contracts: Array<{
    name: string;
    inputSchema: Record<string, unknown>;
    contractVersion?: string;
    contractSchemaHash?: string;
  }>,
  requiredNames: string[] = ["career.workflow.tailor_resume"]
): CareerContractConsistency {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  const mismatches: CareerContractConsistency["mismatches"] = [];
  const canonicalTailor = canonicalTailorResumeContractIdentity();
  for (const toolName of requiredNames) {
    const contract = byName.get(toolName);
    if (!contract) {
      mismatches.push({ toolName, reason: "missing" });
      continue;
    }
    const expectedHash = contractSchemaHash(contract.inputSchema);
    if (contract.contractVersion !== CAREER_TOOL_CONTRACT_VERSION) {
      mismatches.push({
        toolName,
        reason: "version",
        publishedContractVersion: contract.contractVersion,
        publishedSchemaHash: contract.contractSchemaHash,
        expectedSchemaHash: expectedHash
      });
      continue;
    }
    if (contract.contractSchemaHash !== expectedHash) {
      mismatches.push({
        toolName,
        reason: "hash",
        publishedContractVersion: contract.contractVersion,
        publishedSchemaHash: contract.contractSchemaHash,
        expectedSchemaHash: expectedHash
      });
      continue;
    }
    if (toolName === "career.workflow.tailor_resume" && expectedHash !== canonicalTailor.contractSchemaHash) {
      mismatches.push({
        toolName,
        reason: "canonical_schema",
        publishedContractVersion: contract.contractVersion,
        publishedSchemaHash: contract.contractSchemaHash,
        expectedSchemaHash: canonicalTailor.contractSchemaHash
      });
    }
  }
  return {
    ready: mismatches.length === 0,
    ...(mismatches.length ? { reason: "career_tool_contract_mismatch" as const } : {}),
    contractVersion: CAREER_TOOL_CONTRACT_VERSION,
    mismatches
  };
}

/**
 * Deterministic startup self-test. It performs only schema parsing and
 * published-contract identity checks; it never calls a Career domain tool.
 */
export function runCareerToolContractSelfTest(
  contracts: Array<{
    name: string;
    inputSchema: Record<string, unknown>;
    contractVersion?: string;
    contractSchemaHash?: string;
  }>,
  requiredNames: string[] = ["career.workflow.tailor_resume"]
): CareerContractConsistency {
  const representative = canonicalTailorResumeRepresentativeInput();
  const representativeAccepted = TailorResumeInputSchema.safeParse(representative).success;
  const consistency = evaluateCareerToolContractSurface(contracts, requiredNames);
  if (representativeAccepted || !requiredNames.includes("career.workflow.tailor_resume")) return consistency;
  return {
    ...consistency,
    ready: false,
    reason: "career_tool_contract_mismatch",
    mismatches: [
      ...consistency.mismatches,
      { toolName: "career.workflow.tailor_resume", reason: "canonical_schema" }
    ]
  };
}

function normalizePersistenceAlias(value: unknown, allowUnknown: boolean) {
  if (value === "save" || value === "session_only" || value === "ask") return value;
  if (allowUnknown && value === "unknown") return "ask";
  return undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
