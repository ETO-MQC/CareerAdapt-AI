import { z } from "zod";
import { ResumeSectionTypeV2Schema } from "@/domain/schemas";

export const ProfileIntakeNextTurnActionSchema = z.enum([
  "ask_follow_up",
  "ask_next_section",
  "answer_reference",
  "show_draft",
  "offer_finish",
  "start_final_synthesis",
  "report_recoverable_failure"
]);

export const ProfileIntakeNextTurnPlanSchema = z.object({
  action: ProfileIntakeNextTurnActionSchema,
  candidateId: z.string().min(1).optional(),
  candidateLabel: z.string().min(1).optional(),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics", "summary"]).optional(),
  dimension: z.string().min(1).optional(),
  question: z.string().min(1).max(800).optional(),
  acknowledgement: z.string().min(1).max(800).optional(),
  capturedAssetLabels: z.array(z.string().min(1)).max(12).default([]),
  draftSummary: z.string().min(1).max(2400).optional(),
  answer: z.string().min(1).max(800).optional()
}).strict();

export type ProfileIntakeNextTurnAction = z.infer<typeof ProfileIntakeNextTurnActionSchema>;
export type ProfileIntakeNextTurnPlan = z.infer<typeof ProfileIntakeNextTurnPlanSchema>;
