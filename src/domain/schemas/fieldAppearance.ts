import { z } from "zod";

export const FieldAppearanceSchema = z.object({
  itemId: z.string().min(1).max(200),
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  text: z.string().min(1).max(30000),
  occurrence: z.number().int().min(0).max(10000).default(0),
  hidden: z.boolean().optional(),
  ranges: z.array(z.object({
    from: z.number().int().min(0),
    to: z.number().int().positive(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional()
  }).strict()).max(200).default([])
}).strict().superRefine((value, ctx) => {
  value.ranges.forEach((range, index) => {
    if (range.from >= range.to || range.to > value.text.length) ctx.addIssue({ code: "custom", path: ["ranges", index], message: "format range must be inside its anchored text" });
  });
});

export const FieldAppearancesSchema = z.array(FieldAppearanceSchema).max(2000).optional();
export type FieldAppearance = z.infer<typeof FieldAppearanceSchema>;
