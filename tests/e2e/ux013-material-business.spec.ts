import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function open(page: Page) {
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/resume"); }
  await expect(page.getByRole("button", { name: "导入资料", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "导入资料", exact: false }).click();
  return page.getByRole("dialog", { name: "导入资料", exact: true });
}
function material(issuer = "匿名颁发机构", award = false) {
  return JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [{ id: "certificates", sectionType: "certificates", title: "证书", order: 0, visible: true,
      items: [{ id: "certificate-one", sectionType: "certificates", name: "匿名职业资格证书", issuer, issuedAt: "2025-06", customFields: [] }] },
    ...(award ? [{ id: "awards", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award-one", sectionType: "awards", name: "待拒绝团队奖项", customFields: [] }] }] : [])], unclassifiedBlocks: [] });
}
async function upload(page: Page, text: string) {
  const dialog = await open(page);
  await dialog.getByLabel("识别方式").selectOption("local");
  await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("匿名职业资格证书");
  return dialog;
}
async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<{ profiles: Array<{ id: string; name: string; version: number; certificates: Array<{ name: string; issuer?: string }>; structuredFacts?: Array<{ data: { sectionType: string; name?: string } }> }>; branches: unknown[]; revisions: unknown[]; meta: Array<{ key: string; value: unknown }> }>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb"); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(["profiles", "resumeBranches", "resumeRevisions", "appMeta"], "readonly");
      const profiles = tx.objectStore("profiles").getAll(), branches = tx.objectStore("resumeBranches").getAll(), revisions = tx.objectStore("resumeRevisions").getAll(), meta = tx.objectStore("appMeta").getAll();
      tx.oncomplete = () => { db.close(); resolve({ profiles: profiles.result, branches: branches.result, revisions: revisions.result,
        meta: meta.result.filter((row) => /^(material-|importedResumeDraft:|profileReconciliation:|resumeImportOperation:)/u.test(row.key)) }); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}
test("A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources", async ({ page }, info) => {
  let dialog = await upload(page, material("匿名颁发机构", true));
  const before = await snapshot(page);
  await dialog.getByText("创建新人物", { exact: true }).click();
  await dialog.locator('input[name="new-profile-name"]').fill("B012匿名人物");
  const certificateRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  const issuer = certificateRow.getByLabel("材料候选颁发方", { exact: true });
  await issuer.fill("本人核对后的机构"); await issuer.blur();
  await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  const awardRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') });
  await awardRow.locator('input[name$="-included"]').last().uncheck();
  await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("B012匿名人物");
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("review-edited-source.png"), fullPage: true });
  const provisional = await snapshot(page); expect(provisional.profiles).toEqual(before.profiles); expect(provisional.revisions).toEqual(before.revisions);
  await page.reload(); dialog = await open(page);
  await expect(dialog.locator('input[name="new-profile-name"]')).toHaveValue("B012匿名人物");
  await expect(dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') }).getByLabel("材料候选颁发方", { exact: true })).toHaveValue("本人核对后的机构");
  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect.poll(async () => (await snapshot(page)).profiles.some((profile) => profile.name === "B012匿名人物")).toBe(true);
  const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.name === "B012匿名人物")!;
  expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("本人核对后的机构");
  expect(saved.structuredFacts?.some((entry) => entry.data.sectionType === "awards")).toBe(false);
  expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  await writeFile(info.outputPath("formal-before-after.json"), JSON.stringify({ before, provisional, after }, null, 2));
  await page.goto("/profile");
  await page.getByRole("button", { name: /证书/ }).first().click();
  await expect(page.getByText(/原始材料与来源：匿名证书.json/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile-source-after-reload.png"), fullPage: true });
});

test("D: changing target and purpose isolates review identity and makes no formal writes", async ({ page }, info) => {
  const dialog = await upload(page, material());
  const before = await snapshot(page);
  await dialog.getByText("创建新人物", { exact: true }).click();
  await dialog.locator('input[name="new-profile-name"]').fill("另一个人物");
  const purpose = dialog.getByLabel("材料用途", { exact: true }); await purpose.fill("资格复核"); await purpose.blur();
  await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("资格复核");
  const after = await snapshot(page);
  expect(after.profiles).toEqual(before.profiles); expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  const targets = after.meta.filter((row) => row.key.startsWith("material-target:")); expect(targets.length).toBeGreaterThanOrEqual(3);
  await writeFile(info.outputPath("target-isolation.json"), JSON.stringify({ before, after }, null, 2));
  await page.screenshot({ path: info.outputPath("target-purpose-review.png"), fullPage: true });
});

test("B: duplicate receipt, new evidence and explicit conflict resolution keep one entity", async ({ page }, info) => {
  let dialog = await upload(page, material());
  await dialog.getByText("创建新人物", { exact: true }).click();
  await dialog.locator('input[name="new-profile-name"]').fill("B012对账人物");
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload(); const initial = await snapshot(page);
  const person = initial.profiles.find((profile) => profile.name === "B012对账人物")!;
  dialog = await open(page);
  await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(material()) });
  await expect(dialog.getByText(/这份材料已经确认保存/).first()).toBeVisible();
  expect((await snapshot(page)).profiles).toEqual(initial.profiles);
  await page.keyboard.press("Escape");
  dialog = await upload(page, material() + "\n");
  await expect(dialog.locator(".profile-reconciliation-summary").getByText("融合来源")).toBeVisible();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload();
  dialog = await upload(page, material("另一个颁发机构"));
  await expect(dialog.locator(".profile-reconciliation-comparison")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("conflict-before-resolution.png"), fullPage: true });
  await dialog.locator(".profile-reconciliation-actions").getByRole("button", { name: "保留原数据", exact: true }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload(); const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.id === person.id)!;
  expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("匿名颁发机构");
  expect(after.branches).toEqual(initial.branches); expect(after.revisions).toEqual(initial.revisions);
  await writeFile(info.outputPath("dedup-conflict-before-after.json"), JSON.stringify({ initial, after }, null, 2));
});

test("C/manual: unavailable real OCR preserves a decodable image and supports explicit transcription confirmation", async ({ page }, info) => {
  const dialog = await open(page); await dialog.getByLabel("识别方式").selectOption("local");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
    const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 600, 300);
    context.fillStyle = "black"; context.font = "28px sans-serif"; context.fillText("SAMPLE CERTIFICATE", 40, 100); context.fillText("ANONYMOUS ISSUER", 40, 170);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dialog.getByLabel("选择职业材料").setInputFiles({ name: "sample-certificate.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await expect(dialog.getByLabel("对照原件补充文字")).toBeVisible();
  await expect.poll(() => dialog.getByRole("img", { name: "原始材料 sample-certificate.png" }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 600)).toBe(true);
  await page.screenshot({ path: info.outputPath("original-image-manual-review.png"), fullPage: true });
  const before = await snapshot(page);
  await dialog.getByLabel("对照原件补充文字").fill("证书\nSAMPLE CERTIFICATE\nANONYMOUS ISSUER");
  await dialog.getByRole("button", { name: "继续核对", exact: true }).click();
  await writeFile(info.outputPath("classification-layout.json"), JSON.stringify(await dialog.locator('select[name$="-type"]').evaluate((element) => {
    const rows = []; let current: Element | null = element;
    while (current) { const style = getComputedStyle(current); rows.push({ tag: current.tagName, className: current.className, rect: current.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility, height: style.height, overflow: style.overflow }); current = current.parentElement; }
    return rows;
  }), null, 2));
  await expect(dialog.locator('select[name$="-type"]')).toBeVisible();
  await dialog.getByText("创建新人物", { exact: true }).click();
  await dialog.locator('input[name="new-profile-name"]').fill("B012人工转写人物");
  await dialog.locator('select[name$="-type"]').selectOption("certificates");
  await dialog.getByLabel("材料候选证书名称").fill("SAMPLE CERTIFICATE"); await dialog.getByLabel("材料候选证书名称").blur();
  await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain('"userEdited":true');
  await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "profiles") { IDBObjectStore.prototype.put = original; throw new DOMException("B012 storage fault injection", "UnknownError"); }
      return original.apply(this, args);
    };
  });
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  const failed = await snapshot(page); expect(failed.profiles).toEqual(before.profiles); expect(failed.revisions).toEqual(before.revisions);
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload(); const after = await snapshot(page);
  expect(after.profiles.find((profile) => profile.name === "B012人工转写人物")!.certificates[0].name).toBe("SAMPLE CERTIFICATE");
  expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  expect(JSON.stringify(after.meta)).toContain("manual_transcription");
  await writeFile(info.outputPath("manual-transcription-before-after.json"), JSON.stringify({ before, failed, after }, null, 2));
});
