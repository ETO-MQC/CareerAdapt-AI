import { LocalResumePhotoSchema } from "@/domain/schemas/resumePhoto";

export const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 600;

export function validateResumePhotoFile(file: Pick<File, "type" | "size">) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (!file.size || file.size > MAX_PHOTO_UPLOAD_BYTES) throw new Error("照片文件须大于 0 且不超过 5 MB。");
}

/** Decode and re-encode locally: no hosting, metadata, SVG or transient blob URL in storage. */
export async function prepareResumePhoto(file: File): Promise<string> {
  validateResumePhotoFile(file);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("无法读取图片，请选择完整、有效的图片文件。"); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("图片尺寸过大或无效，请选择不超过 4000 万像素的照片。");
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理照片，请重试。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = LocalResumePhotoSchema.safeParse(canvas.toDataURL("image/jpeg", 0.88));
    if (!result.success) throw new Error("处理后的照片仍过大，请选择更小的图片。");
    return result.data;
  } finally { bitmap.close(); }
}
