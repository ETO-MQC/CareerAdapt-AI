import { z } from "zod";

// Encoded output is bounded independently of the original upload size.
export const MAX_RESUME_PHOTO_BYTES = 512 * 1024;
export const LocalResumePhotoSchema = z.string().max(Math.ceil(MAX_RESUME_PHOTO_BYTES / 3) * 4 + 64)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

// Keep historical HTTP(S) references readable. Only embedded raster images are rendered.
export const ResumePhotoSchema = z.union([
  LocalResumePhotoSchema,
  z.string().max(2048).url().refine(value => /^https?:\/\//i.test(value))
]);

export function localResumePhoto(value: unknown): string | undefined {
  const parsed = LocalResumePhotoSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
