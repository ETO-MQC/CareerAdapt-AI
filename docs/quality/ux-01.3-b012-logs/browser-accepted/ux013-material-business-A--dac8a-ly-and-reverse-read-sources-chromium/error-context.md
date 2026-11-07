# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-material-business.spec.ts >> A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources
- Location: tests\e2e\ux013-material-business.spec.ts:37:5

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  getByRole('dialog', { name: '导入资料', exact: true }).getByRole('button', { name: '确认导入', exact: true })
Expected: in viewport
Received: viewport ratio 0.9305555820465088
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).getByRole('button', { name: '确认导入', exact: true })
    14 × locator resolved to <button type="button" class="primary-button">确认导入</button>
       - unexpected value "viewport ratio 0.9305555820465088"

```

```yaml
- button "确认导入"
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { writeFile } from "node:fs/promises";
  3   | 
  4   | async function open(page: Page) {
  5   |   await page.goto("/resume");
  6   |   const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  7   |   if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/resume"); }
  8   |   await expect(page.getByRole("button", { name: "导入资料", exact: false })).toBeVisible();
  9   |   await page.getByRole("button", { name: "导入资料", exact: false }).click();
  10  |   return page.getByRole("dialog", { name: "导入资料", exact: true });
  11  | }
  12  | function material(issuer = "匿名颁发机构", award = false) {
  13  |   return JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
  14  |     sections: [{ id: "certificates", sectionType: "certificates", title: "证书", order: 0, visible: true,
  15  |       items: [{ id: "certificate-one", sectionType: "certificates", name: "匿名职业资格证书", issuer, issuedAt: "2025-06", customFields: [] }] },
  16  |     ...(award ? [{ id: "awards", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award-one", sectionType: "awards", name: "待拒绝团队奖项", customFields: [] }] }] : [])], unclassifiedBlocks: [] });
  17  | }
  18  | async function upload(page: Page, text: string) {
  19  |   const dialog = await open(page);
  20  |   await dialog.getByLabel("识别方式").selectOption("local");
  21  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(text) });
  22  |   await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("匿名职业资格证书");
  23  |   return dialog;
  24  | }
  25  | async function snapshot(page: Page) {
  26  |   return page.evaluate(() => new Promise<{ profiles: Array<{ id: string; name: string; version: number; certificates: Array<{ name: string; issuer?: string }>; structuredFacts?: Array<{ data: { sectionType: string; name?: string } }> }>; branches: unknown[]; revisions: unknown[]; meta: Array<{ key: string; value: unknown }> }>((resolve, reject) => {
  27  |     const request = indexedDB.open("CareerAdaptDb"); request.onerror = () => reject(request.error);
  28  |     request.onsuccess = () => {
  29  |       const db = request.result; const tx = db.transaction(["profiles", "resumeBranches", "resumeRevisions", "appMeta"], "readonly");
  30  |       const profiles = tx.objectStore("profiles").getAll(), branches = tx.objectStore("resumeBranches").getAll(), revisions = tx.objectStore("resumeRevisions").getAll(), meta = tx.objectStore("appMeta").getAll();
  31  |       tx.oncomplete = () => { db.close(); resolve({ profiles: profiles.result, branches: branches.result, revisions: revisions.result,
  32  |         meta: meta.result.filter((row) => /^(material-|importedResumeDraft:|profileReconciliation:|resumeImportOperation:)/u.test(row.key)) }); };
  33  |       tx.onerror = () => reject(tx.error);
  34  |     };
  35  |   }));
  36  | }
  37  | test("A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources", async ({ page }, info) => {
  38  |   let dialog = await upload(page, material("匿名颁发机构", true));
  39  |   const before = await snapshot(page);
  40  |   await dialog.getByText("创建新人物", { exact: true }).click();
  41  |   await dialog.locator('input[name="new-profile-name"]').fill("B012匿名人物");
  42  |   const certificateRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  43  |   const issuer = certificateRow.getByLabel("材料候选颁发方", { exact: true });
  44  |   await issuer.fill("本人核对后的机构"); await issuer.blur();
  45  |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  46  |   const awardRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') });
  47  |   await awardRow.locator('input[name$="-included"]').last().uncheck();
  48  |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("B012匿名人物");
> 49  |   await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeInViewport({ ratio: 1 });
      |                                                                           ^ Error: expect(locator).toBeInViewport() failed
  50  |   await page.screenshot({ path: info.outputPath("review-edited-source.png"), fullPage: true });
  51  |   const provisional = await snapshot(page); expect(provisional.profiles).toEqual(before.profiles); expect(provisional.revisions).toEqual(before.revisions);
  52  |   await page.reload(); dialog = await open(page);
  53  |   await expect(dialog.locator('input[name="new-profile-name"]')).toHaveValue("B012匿名人物");
  54  |   await expect(dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') }).getByLabel("材料候选颁发方", { exact: true })).toHaveValue("本人核对后的机构");
  55  |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  56  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  57  |   await expect(dialog).not.toBeVisible();
  58  |   await page.reload();
  59  |   await expect.poll(async () => (await snapshot(page)).profiles.some((profile) => profile.name === "B012匿名人物")).toBe(true);
  60  |   const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.name === "B012匿名人物")!;
  61  |   expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("本人核对后的机构");
  62  |   expect(saved.structuredFacts?.some((entry) => entry.data.sectionType === "awards")).toBe(false);
  63  |   expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  64  |   await writeFile(info.outputPath("formal-before-after.json"), JSON.stringify({ before, provisional, after }, null, 2));
  65  |   await page.goto("/profile");
  66  |   await page.getByRole("button", { name: /证书/ }).first().click();
  67  |   await expect(page.getByText(/原始材料与来源：匿名证书.json/).first()).toBeVisible();
  68  |   await page.screenshot({ path: info.outputPath("profile-source-after-reload.png"), fullPage: true });
  69  | });
  70  | 
  71  | test("D: changing target and purpose isolates review identity and makes no formal writes", async ({ page }, info) => {
  72  |   const dialog = await upload(page, material());
  73  |   const before = await snapshot(page);
  74  |   await dialog.getByText("创建新人物", { exact: true }).click();
  75  |   await dialog.locator('input[name="new-profile-name"]').fill("另一个人物");
  76  |   const purpose = dialog.getByLabel("材料用途", { exact: true }); await purpose.fill("资格复核"); await purpose.blur();
  77  |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("资格复核");
  78  |   const after = await snapshot(page);
  79  |   expect(after.profiles).toEqual(before.profiles); expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  80  |   const targets = after.meta.filter((row) => row.key.startsWith("material-target:")); expect(targets.length).toBeGreaterThanOrEqual(3);
  81  |   await writeFile(info.outputPath("target-isolation.json"), JSON.stringify({ before, after }, null, 2));
  82  |   await page.screenshot({ path: info.outputPath("target-purpose-review.png"), fullPage: true });
  83  | });
  84  | 
  85  | test("B: duplicate receipt, new evidence and explicit conflict resolution keep one entity", async ({ page }, info) => {
  86  |   let dialog = await upload(page, material());
  87  |   await dialog.getByText("创建新人物", { exact: true }).click();
  88  |   await dialog.locator('input[name="new-profile-name"]').fill("B012对账人物");
  89  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  90  |   await page.reload(); const initial = await snapshot(page);
  91  |   const person = initial.profiles.find((profile) => profile.name === "B012对账人物")!;
  92  |   dialog = await open(page);
  93  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(material()) });
  94  |   await expect(dialog.getByText(/这份材料已经确认保存/).first()).toBeVisible();
  95  |   expect((await snapshot(page)).profiles).toEqual(initial.profiles);
  96  |   await page.keyboard.press("Escape");
  97  |   dialog = await upload(page, material() + "\n");
  98  |   await expect(dialog.locator(".profile-reconciliation-summary").getByText("融合来源")).toBeVisible();
  99  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  100 |   await page.reload();
  101 |   dialog = await upload(page, material("另一个颁发机构"));
  102 |   await expect(dialog.locator(".profile-reconciliation-comparison")).toBeVisible();
  103 |   await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
  104 |   await page.screenshot({ path: info.outputPath("conflict-before-resolution.png"), fullPage: true });
  105 |   await dialog.locator(".profile-reconciliation-actions").getByRole("button", { name: "保留原数据", exact: true }).click();
  106 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  107 |   await page.reload(); const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.id === person.id)!;
  108 |   expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("匿名颁发机构");
  109 |   expect(after.branches).toEqual(initial.branches); expect(after.revisions).toEqual(initial.revisions);
  110 |   await writeFile(info.outputPath("dedup-conflict-before-after.json"), JSON.stringify({ initial, after }, null, 2));
  111 | });
  112 | 
  113 | test("C/manual: unavailable real OCR preserves a decodable image and supports explicit transcription confirmation", async ({ page }, info) => {
  114 |   const dialog = await open(page); await dialog.getByLabel("识别方式").selectOption("local");
  115 |   const image = await page.evaluate(() => {
  116 |     const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
  117 |     const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 600, 300);
  118 |     context.fillStyle = "black"; context.font = "28px sans-serif"; context.fillText("SAMPLE CERTIFICATE", 40, 100); context.fillText("ANONYMOUS ISSUER", 40, 170);
  119 |     return canvas.toDataURL("image/png").split(",")[1];
  120 |   });
  121 |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "sample-certificate.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  122 |   await expect(dialog.getByLabel("对照原件补充文字")).toBeVisible();
  123 |   await expect.poll(() => dialog.getByRole("img", { name: "原始材料 sample-certificate.png" }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 600)).toBe(true);
  124 |   await page.screenshot({ path: info.outputPath("original-image-manual-review.png"), fullPage: true });
  125 |   const before = await snapshot(page);
  126 |   await dialog.getByLabel("对照原件补充文字").fill("证书\nSAMPLE CERTIFICATE\nANONYMOUS ISSUER");
  127 |   await dialog.getByRole("button", { name: "继续核对", exact: true }).click();
  128 |   await writeFile(info.outputPath("classification-layout.json"), JSON.stringify(await dialog.locator('select[name$="-type"]').evaluate((element) => {
  129 |     const rows = []; let current: Element | null = element;
  130 |     while (current) { const style = getComputedStyle(current); rows.push({ tag: current.tagName, className: current.className, rect: current.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility, height: style.height, overflow: style.overflow }); current = current.parentElement; }
  131 |     return rows;
  132 |   }), null, 2));
  133 |   await expect(dialog.locator('select[name$="-type"]')).toBeVisible();
  134 |   await dialog.getByText("创建新人物", { exact: true }).click();
  135 |   await dialog.locator('input[name="new-profile-name"]').fill("B012人工转写人物");
  136 |   await dialog.locator('select[name$="-type"]').selectOption("certificates");
  137 |   await dialog.getByLabel("材料候选证书名称").fill("SAMPLE CERTIFICATE"); await dialog.getByLabel("材料候选证书名称").blur();
  138 |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain('"userEdited":true');
  139 |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  140 |   await page.evaluate(() => {
  141 |     const original = IDBObjectStore.prototype.put;
  142 |     IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
  143 |       if (this.name === "profiles") { IDBObjectStore.prototype.put = original; throw new DOMException("B012 storage fault injection", "UnknownError"); }
  144 |       return original.apply(this, args);
  145 |     };
  146 |   });
  147 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  148 |   await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  149 |   const failed = await snapshot(page); expect(failed.profiles).toEqual(before.profiles); expect(failed.revisions).toEqual(before.revisions);
```