import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readStore } from './support/p51CoreWorkflow';

test('RP01 real image safe import review', async ({ page }) => {
  test.setTimeout(360_000); page.setDefaultTimeout(30_000);
  const report: Record<string, unknown> = { scenario: 9, status: 'UNKNOWN' };
  const save = () => fs.writeFileSync('docs/quality/rp01-logs/vision-browser.json', JSON.stringify(report, null, 2) + '\n');
  try {
    await page.goto('/resume', { waitUntil: 'domcontentloaded' });
    const before = { profiles: await readStore(page, 'profiles'), revisions: await readStore(page, 'resumeRevisions') };
    await page.getByRole('button', { name: /导入已有简历/ }).click();
    const dialog = page.getByRole('dialog', { name: '导入简历' });
    await dialog.getByRole('button', { name: '使用 AI 智能识别', exact: true }).click();
    await dialog.getByLabel('选择要导入的简历文件').setInputFiles(path.resolve('docs/quality/rp01-logs/synthetic-resume.png'));
    await expect.poll(async () => await dialog.locator('.import-review-footer').count() > 0 || await dialog.locator('.import-recognition-recovery').count() > 0, { timeout: 240_000 }).toBe(true);
    report.text = await dialog.textContent();
    report.recovery = await dialog.locator('.import-recognition-recovery').count();
    report.appMeta = await readStore(page, 'appMeta');
    report.aiLogs = await readStore(page, 'aiLogs');
    report.profilesUnchanged = JSON.stringify(await readStore(page, 'profiles')) === JSON.stringify(before.profiles);
    report.revisionsUnchanged = JSON.stringify(await readStore(page, 'resumeRevisions')) === JSON.stringify(before.revisions);
    report.status = report.recovery ? 'PARTIAL' : 'PASS';
    await page.screenshot({ path: 'docs/quality/rp01-logs/vision-review.png', fullPage: true });
    expect(report.profilesUnchanged).toBe(true); expect(report.revisionsUnchanged).toBe(true);
    expect(report.recovery).toBe(0);
  } catch (error) { report.status = 'BLOCKED'; report.error = String(error); throw error; }
  finally { save(); }
});
