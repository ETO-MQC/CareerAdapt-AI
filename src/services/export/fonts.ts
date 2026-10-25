import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResumePresentationConfig } from "@/domain/schemas";
import { CHINESE_FONTS, ENGLISH_FONTS } from "@/domain/resumePresentation/fonts";

/** Embed only the selected local faces; standalone Chromium never fetches fonts from a server. */
export async function embeddedResumeFontCss(typography: ResumePresentationConfig["typography"]) {
  const faces = [CHINESE_FONTS.find(font => font.id === typography.chineseFont), ENGLISH_FONTS.find(font => font.id === typography.englishFont)];
  return (await Promise.all(faces.map(async face => {
    if (!face || !("asset" in face)) return "";
    const bytes = await readFile(join(process.cwd(), "public", "fonts", face.asset));
    return `@font-face { font-family: ${face.family}; src: url(data:font/${face.format === "opentype" ? "otf" : "ttf"};base64,${bytes.toString("base64")}) format("${face.format}"); font-style: normal; font-weight: ${face.format === "opentype" ? "400" : "100 900"}; font-display: block; }`;
  }))).join("\n");
}
