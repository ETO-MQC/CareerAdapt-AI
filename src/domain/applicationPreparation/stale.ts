import {
  ApplicationPreparationPackSchema,
  type ApplicationPreparationPack,
  type BaseApplicationMaterial
} from "@/domain/schemas";
import { type ApplicationPreparationContext } from "./context";

export function rebaseApplicationPreparationPack(input: {
  pack: ApplicationPreparationPack;
  context: ApplicationPreparationContext;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const nextBasedOn = {
    branchId: input.context.branchId,
    revisionId: input.context.revisionId,
    branchRevision: input.context.branchRevision,
    presentationRevision: input.context.presentationRevision,
    requirementsHash: input.context.requirementsHash,
    exportRecordId: input.context.exportRecordId
  };
  const materials = input.pack.materials;
  const next = {
    ...materials,
    coverLetters: mapRecord(materials.coverLetters, (material) => markMaterialStaleIfNeeded(material, input.context, now)),
    applicationEmails: mapRecord(materials.applicationEmails, (material) => markMaterialStaleIfNeeded(material, input.context, now)),
    selfIntroductions: mapRecord(materials.selfIntroductions, (material) => markMaterialStaleIfNeeded(material, input.context, now)),
    interviewQuestions: materials.interviewQuestions.map((material) => markMaterialStaleIfNeeded(material, input.context, now)),
    starStories: materials.starStories.map((material) => markMaterialStaleIfNeeded(material, input.context, now))
  };
  const changed = JSON.stringify(input.pack.basedOn) !== JSON.stringify(nextBasedOn)
    || JSON.stringify(input.pack.materials) !== JSON.stringify(next);

  return ApplicationPreparationPackSchema.parse({
    ...input.pack,
    basedOn: nextBasedOn,
    materials: next,
    updatedAt: changed ? now : input.pack.updatedAt,
    version: changed ? input.pack.version + 1 : input.pack.version
  });
}

export function isMaterialStale(material: Pick<BaseApplicationMaterial, "basedOnRevisionId" | "basedOnBranchRevision" | "basedOnRequirementsHash">, context: ApplicationPreparationContext) {
  return material.basedOnRevisionId !== context.revisionId
    || material.basedOnBranchRevision !== context.branchRevision
    || material.basedOnRequirementsHash !== context.requirementsHash;
}

function markMaterialStaleIfNeeded<T extends BaseApplicationMaterial | undefined>(
  material: T,
  context: ApplicationPreparationContext,
  now: string
): T {
  if (!material || material.status === "not_needed" || material.status === "not_started") {
    return material;
  }
  if (!isMaterialStale(material, context)) {
    return material;
  }
  return {
    ...material,
    status: "stale",
    guardReasons: Array.from(new Set([...material.guardReasons, "Application 选定 Revision 或岗位要求已变化，需要重新生成或复核。"])),
    updatedAt: now
  };
}

function mapRecord<T extends Record<string, BaseApplicationMaterial | undefined>>(
  record: T,
  mapper: (material: T[keyof T]) => T[keyof T]
): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapper(value as T[keyof T])])) as unknown as T;
}
