import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const OUT = process.env.PARITY_OUT ?? join(ROOT, "tmp", "render-parity");
const MM = 96 / 25.4;

// Real preview CSS: what the browser actually loads after the Tailwind/PostCSS build.
const chunkDir = join(ROOT, ".next", "dev", "static", "chunks");
const builtFiles = (await readdir(chunkDir)).filter((name) => name.endsWith(".css"));
const builtCss = (
  await Promise.all(builtFiles.map(async (name) => readFile(join(chunkDir, name), "utf8")))
).join("\n");

// Real PDF CSS: what pdfHtml.tsx feeds to page.setContent().
const globalsCss = await readFile(join(ROOT, "src", "app", "globals.css"), "utf8");
const pdfCss = globalsCss.replace(/@tailwind\s+[^;]+;/g, "");

const hasPreflight = (css) => /\*,\s*::before,\s*::after\s*\{[^}]*box-sizing:\s*border-box/.test(css);

const fixture = `
<article class="resume-a4-page resume-template-campus-clean">
  <header class="resume-template-header"><h1 class="resume-name">张三</h1><p class="resume-headline">后端工程师</p></header>
  <section class="resume-section" data-render-section="summary">
    <h2 class="resume-section-title">自我评价</h2>
    <div class="resume-presentation-summary"><p>${["第一段说明：负责支付平台的稳定性治理与容量规划。", "第二段说明：主导了三次大促的全链路压测与预案演练。"].join("\n")}</p></div>
  </section>
  <section class="resume-section" data-render-section="experience">
    <h2 class="resume-section-title">工作经历</h2>
    <div class="resume-block">
      <p class="resume-item-header">某公司 · 工程师</p>
      <p class="resume-presentation-description">${["第一段说明：负责支付平台的稳定性治理与容量规划。", "第二段说明：主导了三次大促的全链路压测与预案演练。"].join("\n")}</p>
      <ul class="resume-presentation-highlights"><li>要点一：把核心链路延迟从 480ms 降到 120ms。</li><li>要点二：建立灰度发布流程，事故回滚时间缩短 70%。</li></ul>
    </div>
  </section>
  <section class="resume-section" data-render-section="skills">
    <h2 class="resume-section-title">专业技能</h2>
    <span class="resume-skill-description">熟悉 Java 与 Spring 生态</span>
  </section>
</article>`;

function html(css) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style>
<style>
  html,body{background:#fff;margin:0;min-height:297mm;width:210mm}
  body{display:block;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}
  .resume-preview-pages{display:block}.resume-page-shell{display:block}
  .resume-a4-page{box-shadow:none !important;height:297mm;margin:0 !important;width:210mm}
  *,::before,::after{box-sizing:border-box;border-width:0;border-style:solid}
  h1,h2,h3,h4,h5,h6,p,figure,blockquote,dl,dd,pre{margin:0}
  ul,ol{margin:0}
</style></head><body><div class="resume-preview-pages"><div class="resume-page-shell">${fixture}</div></div></body></html>`;
}

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: "msedge", headless: true }));
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });

async function measure(css, media, label) {
  await page.emulateMedia({ media });
  await page.setContent(html(css), { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: true });
  return page.evaluate((mm) => {
    const pageEl = document.querySelector(".resume-a4-page");
    const base = pageEl.getBoundingClientRect().top;
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        topMm: +((rect.top - base) / mm).toFixed(3),
        heightMm: +(rect.height / mm).toFixed(3),
        marginTop: s.marginTop, marginBottom: s.marginBottom,
        paddingTop: s.paddingTop, fontSize: s.fontSize, lineHeight: s.lineHeight,
        whiteSpace: s.whiteSpace
      };
    };
    return {
      zoom: getComputedStyle(document.querySelector(".resume-preview-pages")).zoom,
      totalHeightMm: +(pageEl.getBoundingClientRect().height / mm).toFixed(3),
      contentBottomMm: +((Math.max(...[...pageEl.querySelectorAll("section")].map((s) => s.getBoundingClientRect().bottom)) - base) / mm).toFixed(3),
      name: read(".resume-name"), headline: read(".resume-headline"),
      sectionTitle: read(".resume-section-title"),
      summary: read(".resume-presentation-summary p"),
      description: read(".resume-presentation-description"),
      highlight: read(".resume-presentation-highlights li"),
      skill: read(".resume-skill-description")
    };
  }, MM);
}

const preview = await measure(builtCss, "screen", "preview-built-screen");
const pdf = await measure(pdfCss, "print", "pdf-nopreflight-print");

await page.emulateMedia({ media: "print" });
await page.setContent(html(pdfCss), { waitUntil: "networkidle" });
await page.evaluate(async () => { if ("fonts" in document) await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
await writeFile(join(OUT, "server-parity.pdf"), await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
await browser.close();

const keys = ["name", "headline", "sectionTitle", "summary", "description", "highlight", "skill"];
const report = {
  preflightPresence: { previewCss: hasPreflight(builtCss), pdfCss: hasPreflight(pdfCss) },
  sensitivityControl: "previewCss is expected to contain preflight and pdfCss not to; if so the probe can detect removal.",
  zoom: { preview: preview.zoom, pdf: pdf.zoom },
  page: {
    previewTotalHeightMm: preview.totalHeightMm, pdfTotalHeightMm: pdf.totalHeightMm,
    previewContentBottomMm: preview.contentBottomMm, pdfContentBottomMm: pdf.contentBottomMm
  },
  deltas: keys.flatMap((key) => {
    const a = preview[key]; const b = pdf[key];
    if (!a || !b) return [{ key, missing: true }];
    return [{
      key,
      deltaTopMm: +(b.topMm - a.topMm).toFixed(3),
      deltaHeightMm: +(b.heightMm - a.heightMm).toFixed(3),
      previewTopMm: a.topMm, pdfTopMm: b.topMm,
      previewHeightMm: a.heightMm, pdfHeightMm: b.heightMm,
      previewMargin: `${a.marginTop} / ${a.marginBottom}`, pdfMargin: `${b.marginTop} / ${b.marginBottom}`,
      previewFontSize: a.fontSize, pdfFontSize: b.fontSize,
      previewWhiteSpace: a.whiteSpace, pdfWhiteSpace: b.whiteSpace
    }];
  })
};

console.log(JSON.stringify(report, null, 2));
await writeFile(join(OUT, "parity-vs-built.json"), JSON.stringify(report, null, 2));
