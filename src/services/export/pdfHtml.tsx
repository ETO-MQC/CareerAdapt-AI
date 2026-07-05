import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToReadableStream } from "react-dom/server.edge";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { getResumeTemplate, resumeTemplateStyleVars } from "@/components/resume/templates/templateRegistry";
import { presentationConfigFromExportSnapshot } from "./snapshot";

export async function renderResumePdfHtml(snapshot: ResumePdfExportSnapshot) {
  const css = await readResumeCss();
  const template = getResumeTemplate(snapshot.templateId);
  const presentationConfig = presentationConfigFromExportSnapshot(snapshot);
  const stream = await renderToReadableStream(
    <article
      className={`resume-a4-page ${template.className}`}
      style={resumeTemplateStyleVars(template, presentationConfig)}
      data-testid="resume-a4-page"
      aria-label="A4 简历 PDF"
    >
      {template.render(snapshot.renderModel, { presentationConfig })}
    </article>
  );
  const markup = await new Response(stream).text();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(snapshot.filename)}</title>
  <style>${css}</style>
  <style>
    html, body {
      background: #ffffff;
      margin: 0;
      min-height: 297mm;
      width: 210mm;
    }

    body {
      display: block;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", Arial, sans-serif;
    }

    .resume-a4-page {
      box-shadow: none !important;
      margin: 0 !important;
    }
  </style>
</head>
<body>${markup}</body>
</html>`;
}

async function readResumeCss() {
  const css = await readFile(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  return css.replace(/@tailwind\s+[^;]+;/g, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
