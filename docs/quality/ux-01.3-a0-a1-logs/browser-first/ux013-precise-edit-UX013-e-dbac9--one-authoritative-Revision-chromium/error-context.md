# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-precise-edit.spec.ts >> UX013 explicit field selection review refresh and one authoritative Revision
- Location: tests\e2e\ux013-precise-edit.spec.ts:6:5

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '跳过，先体验其他功能' })

```

# Page snapshot

```yaml
- generic:
  - generic [active]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - navigation [ref=e6]:
            - button "previous" [disabled] [ref=e7]:
              - img "previous" [ref=e8]
            - generic [ref=e10]:
              - generic [ref=e11]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e12]:
              - img "next" [ref=e13]
          - img
        - generic [ref=e15]:
          - link "Next.js 16.2.9 (stale) Webpack" [ref=e16] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e17]
            - generic "There is a newer version (16.4.5) available, upgrade recommended!" [ref=e19]: Next.js 16.2.9 (stale)
            - generic [ref=e20]: Webpack
          - img
      - dialog "Build Error" [ref=e22]:
        - generic [ref=e25]:
          - generic [ref=e26]:
            - generic [ref=e27]:
              - generic [ref=e29]: Build Error
              - generic [ref=e30]:
                - button "Copy Error Info" [ref=e31] [cursor=pointer]:
                  - img [ref=e32]
                - link "Go to related documentation" [ref=e34] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/messages/import-esm-externals
                  - img [ref=e35]
                - button "Attach Node.js inspector" [ref=e37] [cursor=pointer]:
                  - img [ref=e38]
            - generic [ref=e47]: "Module not found: ESM packages (pdfjs-dist/build/pdf.worker.mjs) need to be imported. Use 'import' to reference the package instead. https://nextjs.org/docs/messages/import-esm-externals"
          - generic [ref=e49]:
            - generic [ref=e51]:
              - img [ref=e53]
              - generic [ref=e57]: ./src/services/pdf/extractText.ts (99:43)
              - button "Open in editor" [ref=e58] [cursor=pointer]:
                - img [ref=e60]
            - generic [ref=e63]:
              - generic [ref=e64]:
                - text: "Module not found: ESM packages (pdfjs-dist/build/pdf.worker.mjs) need to be imported. Use 'import' to reference the package instead."
                - link "https://nextjs.org/docs/messages/import-esm-externals" [ref=e65] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/messages/import-esm-externals
                - text: "97 | const pdfjs = await import(\"pdfjs-dist\"); 98 | const pdfJsVersion = typeof pdfjs.version === \"string\" ? pdfjs.version : \"unknown\"; > 99 | pdfjs.GlobalWorkerOptions.workerSrc = new URL(\"pdfjs-dist/build/pdf.worker.mjs\", impo... | ^ 100 | 101 | loadingTask = pdfjs.getDocument({ 102 | data: new Uint8Array(buffer),"
                - link "https://nextjs.org/docs/messages/module-not-found" [ref=e66] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/messages/module-not-found
                - text: "Import trace for requested module:"
              - link "./src/services/resumeImport/ResumeImportOrchestrator.ts" [ref=e67] [cursor=pointer]:
                - text: ./src/services/resumeImport/ResumeImportOrchestrator.ts
                - img [ref=e68]
              - link "./src/services/agent/agentToolService.ts" [ref=e72] [cursor=pointer]:
                - text: ./src/services/agent/agentToolService.ts
                - img [ref=e73]
              - link "./src/components/agent/runtime/AgentRuntimeProvider.tsx" [ref=e77] [cursor=pointer]:
                - text: ./src/components/agent/runtime/AgentRuntimeProvider.tsx
                - img [ref=e78]
        - generic [ref=e82]: "1"
        - generic [ref=e83]: "2"
    - generic [ref=e88] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e89]:
        - img [ref=e90]
      - button "Open issues overlay" [ref=e94]:
        - generic [ref=e95]:
          - generic [ref=e96]: "0"
          - generic [ref=e97]: "1"
        - generic [ref=e98]: Issue
  - alert [ref=e99]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { prepareCoreSourceResume, readStore } from "./support/p51CoreWorkflow";
  3  | import { mkdir, writeFile } from "node:fs/promises";
  4  | import type { ResumeBranch } from "@/domain/schemas";
  5  | 
  6  | test("UX013 explicit field selection review refresh and one authoritative Revision", async ({ page }, info) => {
  7  |   test.setTimeout(120_000);
  8  |   // No model quota or runtime request: this exercises the user-entered wording route through the same Facade/Gateway.
  9  |   await page.route("**/api/ai/**", route => route.abort());
  10 |   await page.goto("/setup");
> 11 |   await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
     |                                                          ^ Error: locator.click: Test timeout of 120000ms exceeded.
  12 |   await prepareCoreSourceResume(page);
  13 |   const before = { branches: await readStore(page, "resumeBranches"), profiles: await readStore(page, "profiles"), revisions: await readStore(page, "resumeRevisions") };
  14 |   const branch = before.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  15 |   expect(branch).toBeTruthy();
  16 |   await page.goto("/ai-workspace");
  17 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  18 |   const panel = page.getByTestId("precise-resume-editor");
  19 |   await panel.locator("summary").click();
  20 |   await panel.getByLabel("精确修改简历", { exact: true }).selectOption(branch.id);
  21 |   const option = await panel.getByLabel("精确修改字段", { exact: true }).locator("option").filter({ hasText: /要点 1/ }).getAttribute("value");
  22 |   expect(option).toBeTruthy();
  23 |   await panel.getByLabel("精确修改字段", { exact: true }).selectOption(option!);
  24 |   await panel.getByRole("button", { name: "选择此字段", exact: true }).click();
  25 |   await panel.getByLabel("建议措辞", { exact: true }).fill("参与需求梳理、原型设计和功能验收等 AI 应用项目工作。");
  26 |   await panel.getByRole("button", { name: "生成审核提案", exact: true }).click();
  27 |   await expect(panel.getByRole("region", { name: "精确修改审核" })).toBeVisible();
  28 |   expect(await readStore(page, "resumeRevisions")).toEqual(before.revisions);
  29 |   await page.reload();
  30 |   await panel.locator("summary").click();
  31 |   await expect(panel.getByText("建议：参与需求梳理、原型设计和功能验收等 AI 应用项目工作。", { exact: true })).toBeVisible();
  32 |   await page.screenshot({ path: info.outputPath("proposal.png"), fullPage: true });
  33 |   await panel.getByRole("button", { name: "确认修改", exact: true }).click();
  34 |   await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  35 |   const after = { branches: await readStore(page, "resumeBranches"), profiles: await readStore(page, "profiles"), revisions: await readStore(page, "resumeRevisions") };
  36 |   expect(after.profiles).toEqual(before.profiles);
  37 |   expect(after.branches).toHaveLength(before.branches.length);
  38 |   expect(after.revisions).toHaveLength(before.revisions.length + 1);
  39 |   const revised = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  40 |   const revisionId = revised.currentRevisionId;
  41 |   expect(after.revisions.some(r => r.id === revisionId && r.previousRevisionId === branch.currentRevisionId)).toBe(true);
  42 |   await page.reload(); await panel.locator("summary").click();
  43 |   await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  44 |   expect(await readStore(page, "resumeRevisions")).toEqual(after.revisions);
  45 |   await page.screenshot({ path: info.outputPath("saved.png"), fullPage: true });
  46 |   await mkdir("docs/quality/ux-01.3-a0-a1-logs", { recursive: true });
  47 |   await writeFile("docs/quality/ux-01.3-a0-a1-logs/browser-data.json", JSON.stringify({ before, after, revisionId }, null, 2));
  48 | });
  49 | 
```