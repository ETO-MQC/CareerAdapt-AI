import { z } from "zod";
import { CertificateSchema, ExperienceSchema, SkillSchema } from "./profile";

const RecycleBaseSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  deletedAt: z.string().datetime({ offset: true })
});

export const ProfileRecycleItemSchema = z.discriminatedUnion("kind", [
  RecycleBaseSchema.extend({ kind: z.literal("experience"), value: ExperienceSchema }),
  RecycleBaseSchema.extend({ kind: z.literal("certificate"), value: CertificateSchema }),
  RecycleBaseSchema.extend({ kind: z.literal("skill"), value: SkillSchema }),
  RecycleBaseSchema.extend({ kind: z.literal("custom"), value: z.string().min(1) })
]);

export const RecycleBinStateSchema = z.object({
  version: z.literal(1),
  jobIds: z.array(z.string().min(1)).default([]),
  profileItems: z.array(ProfileRecycleItemSchema).default([])
});

export type ProfileRecycleItem = z.infer<typeof ProfileRecycleItemSchema>;
export type RecycleBinState = z.infer<typeof RecycleBinStateSchema>;
