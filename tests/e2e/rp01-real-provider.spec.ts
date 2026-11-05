import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { readStore, prepareCoreSourceResume } from './support/p51CoreWorkflow';
import cases from '../fixtures/skills-quality-eval-v1.json';

async function prepareQualificationResume(page: import('@playwright/test').Page, scenario: number) {
  if (scenario >= 6) return prepareCoreSourceResume(page);
  const description = scenario === 3 ? '课程中用 R 清洗数据。' : scenario === 4 ? '课程中用 Excel 和 R 整理数据。' : '用 Excel 合并三份课程数据，完成数据清洗，最后提交核对报告。';
  await page.goto('/resume', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /导入已有简历/ }).click();
  const dialog = page.getByRole('dialog', { name: '导入简历' });
  await dialog.getByText('粘贴 JSON', { exact: true }).click();
  await dialog.getByLabel('JSON 内容').fill(JSON.stringify({ schemaVersion: 'careeradapt-resume-v2', locale: 'zh-CN', basics: { name: '合成候选人', phone: '', email: '', portfolioLinks: [], otherLinks: [], customFields: [] }, sections: [{ id: 'project', sectionType: 'project', title: '项目经历', order: 0, visible: true, items: [{ id: 'rp01-project', sectionType: 'project', title: '课程数据整理', role: '项目成员', startDate: '2025-01', endDate: '2025-06', current: false, description, highlights: [description], tools: [], outcomes: [], customFields: [] }] }], unclassifiedBlocks: [] }));
  await dialog.getByRole('button', { name: '导入 JSON', exact: true }).click();
  await dialog.locator('label.import-target-option').filter({ hasText: '创建新人物' }).click();
  for (let i = 0; i < 40 && await page.getByRole('button', { name: '确认此字段', exact: true }).count(); i++) await page.getByRole('button', { name: '确认此字段', exact: true }).first().click();
  for (let i = 0; i < 40 && await page.getByRole('button', { name: '核对并保留来源', exact: true }).count(); i++) await page.getByRole('button', { name: '核对并保留来源', exact: true }).first().click();
  await dialog.locator('.import-review-footer button.primary-button').click();
  const open = page.getByRole('button', { name: '打开', exact: true }); if (await open.isVisible()) await open.click();
  await expect(page.getByTestId('resume-studio-shell')).toBeVisible();
}

test('RP01 isolated first complete business probe', async ({ page }) => {
  const settings = { provider: 'openai-compatible', baseUrl: process.env.HERMES_INTEGRATION_REAL_PROVIDER_URL, apiKey: process.env.HERMES_INTEGRATION_REAL_PROVIDER_KEY, model: process.env.HERMES_INTEGRATION_REAL_PROVIDER_MODEL, credentialAction: 'replace' };
  await page.addInitScript(value => { localStorage.setItem('careeradapt-ai-settings', JSON.stringify(value)); localStorage.setItem('careeradapt.agent.activeSessionId', '__careeradapt_new_task__'); }, settings);
  const tools: unknown[] = [];
  page.on('response', async response => {
    const url = new URL(response.url());
    if (url.pathname === '/api/agent/mcp' && url.searchParams.get('bridge') === '1' && response.request().method() === 'GET') {
      const payload = await response.json().catch(() => undefined);
      if (payload?.requests?.length) tools.push(...payload.requests);
    }
  });
  const record: Record<string, unknown> = { scenario: 1, startedAt: new Date().toISOString(), status: 'UNKNOWN', tools };
  const save = () => { fs.mkdirSync('docs/quality/rp01-logs', { recursive: true }); fs.writeFileSync('docs/quality/rp01-logs/business-probe.json', JSON.stringify(record, null, 2) + '\n'); };
  try {
    await page.goto('/ai-workspace');
    await expect(page.locator('.agent-runtime-status')).toHaveAttribute('aria-label', /状态 Ready/u, { timeout: 180_000 });
    record.runtimeReady = true;
    const before = { profiles: await readStore(page, 'profiles'), revisions: await readStore(page, 'resumeRevisions') };
    await page.getByLabel('描述你的求职任务').fill('请帮我整理职业资料，先给出候选并让我核对，不要写入正式资料库。我参加过一个项目，用 Excel 合并三份课程数据，完成数据清洗，最后提交核对报告。我还会 SQL 基础查询。');
    const start = Date.now();
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const assistants = page.locator('[data-message-role="assistant"]');
    await expect.poll(async () => assistants.last().getAttribute('data-message-status'), { timeout: 240_000, intervals: [1000, 2000] }).toMatch(/^(complete|failed)$/u);
    record.elapsedMs = Date.now() - start;
    record.messageStatus = await assistants.last().getAttribute('data-message-status');
    record.assistant = await assistants.last().textContent();
    record.sessions = await readStore(page, 'agentSessions');
    record.profilesUnchanged = JSON.stringify(await readStore(page, 'profiles')) === JSON.stringify(before.profiles);
    record.revisionsUnchanged = JSON.stringify(await readStore(page, 'resumeRevisions')) === JSON.stringify(before.revisions);
    record.status = record.messageStatus === 'complete' && tools.length ? 'PARTIAL' : 'BLOCKED';
    save();
    expect(record.profilesUnchanged).toBe(true);
    expect(record.revisionsUnchanged).toBe(true);
    expect(record.messageStatus).toBe('complete');
    expect(tools.length).toBeGreaterThan(0);
    // Only a successful first business probe allows subsequent business collection.
    await prepareCoreSourceResume(page);
    record.sourceResumePrepared = true; save();
  } catch (error) { record.status = 'BLOCKED'; record.error = String(error); save(); throw error; }
});

test('RP01 remaining business collection', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const results: Array<Record<string, unknown>> = [];
  const save = () => fs.writeFileSync('docs/quality/rp01-logs/business-scenarios.json', JSON.stringify(results, null, 2) + '\n');
  const scenarios = [
    ...['jd_understanding-01', 'jd_understanding-02', 'guided_clarification-01', 'guided_clarification-02'].map((id, index) => ({ scenario: index + 2, ...cases.cases.find(row => row.id === id)!, seed: false })),
    { scenario: 6, id: 'general-review', prompt: '完整审阅当前选定的通用简历，只读，不修改、不生成改写。请真正调用审阅能力，展示HR、内容、ATS、Claim Risk并定位原文。', followUpTurns: [], seed: true },
    { scenario: 7, id: 'targeted-resume', prompt: '目标岗位：AI应用产品实习生，必须参与需求梳理、原型设计和功能验收。请用当前通用简历真实经历完成岗位匹配和定向简历提案，等我明确确认后再保存岗位分支，不同步资料库。', followUpTurns: [], seed: true },
    { scenario: 8, id: 'specific-edit', prompt: '读取当前通用简历当前Revision，只修改项目经历中“参与 AI 应用项目的需求梳理、原型设计和功能验收。”这条，把措辞改得简洁清晰；其他字段、顺序和样式不变，不加新事实。先给提案，等我明确确认。', followUpTurns: [], seed: true }
  ];
  for (const scenario of scenarios) {
    const stopped = await fetch(process.env.RP01_PROXY_STATUS!).then(response => response.json());
    if (stopped.stopped) { results.push({ scenario: scenario.scenario, id: scenario.id, status: 'BLOCKED', reason: 'upstream stop condition; not sent' }); save(); continue; }
    const context = await browser.newContext({ baseURL: process.env.HERMES_INTEGRATION_BASE_URL }); const page = await context.newPage();
    page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(30_000);
    const tools: unknown[] = [];
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.pathname === '/api/agent/mcp' && url.searchParams.get('bridge') === '1' && response.request().method() === 'GET') {
        const data = await response.json().catch(() => undefined); if (data?.requests?.length) tools.push(...data.requests);
      }
    });
    const row: Record<string, unknown> = { scenario: scenario.scenario, id: scenario.id, prompt: scenario.prompt, status: 'UNKNOWN', tools, turns: [] };
    results.push(row); save();
    try {
      await page.addInitScript(value => { localStorage.setItem('careeradapt-ai-settings', JSON.stringify(value)); }, { provider: 'openai-compatible', baseUrl: process.env.HERMES_INTEGRATION_REAL_PROVIDER_URL, apiKey: 'rp01-local-forwarder-only', model: process.env.HERMES_INTEGRATION_REAL_PROVIDER_MODEL });
      row.stage = 'navigate'; save();
      await page.goto('/ai-workspace', { waitUntil: 'domcontentloaded' });
      row.stage = 'runtime-ready'; save();
      await expect(page.locator('.agent-runtime-status')).toHaveAttribute('aria-label', /状态 Ready/u, { timeout: 120_000 });
      row.stage = 'seed'; save();
      await prepareQualificationResume(page, scenario.scenario);
      row.stage = 'return-workspace'; save();
      await page.goto('/ai-workspace', { waitUntil: 'domcontentloaded' }); await expect(page.getByLabel('描述你的求职任务')).toBeEnabled();
      const previous = await page.evaluate(() => localStorage.getItem('careeradapt.agent.activeSessionId'));
      await page.getByRole('button', { name: '新任务', exact: true }).click();
      await expect.poll(async () => {
        const id = await page.evaluate(() => localStorage.getItem('careeradapt.agent.activeSessionId'));
        return !!id && id !== previous && (await readStore(page, 'agentSessions')).some(session => session.id === id);
      }).toBe(true);
      await expect(page.locator('.agent-runtime-status')).toHaveAttribute('aria-label', /状态 Ready/u, { timeout: 90_000 });
      const before = { profiles: await readStore(page, 'profiles'), revisions: await readStore(page, 'resumeRevisions'), branches: await readStore(page, 'resumeBranches') };
      row.before = before;
      row.stage = 'business-turn'; save();
      for (const prompt of [scenario.prompt, ...scenario.followUpTurns]) {
        const count = await page.locator('[data-message-role="assistant"]').count();
        const started = Date.now();
        await page.getByLabel('描述你的求职任务').fill(prompt);
        await expect(page.getByLabel('描述你的求职任务')).toHaveValue(prompt);
        await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        const assistants = page.locator('[data-message-role="assistant"]');
        await expect.poll(() => assistants.count(), { timeout: 180_000 }).toBeGreaterThan(count);
        await expect.poll(() => assistants.last().getAttribute('data-message-status'), { timeout: 240_000, intervals: [1000, 2000] }).toMatch(/^(complete|failed)$/u);
        (row.turns as unknown[]).push({ prompt, elapsedMs: Date.now() - started, status: await assistants.last().getAttribute('data-message-status'), text: await assistants.last().textContent() });
        save();
      }
      row.after = { profiles: await readStore(page, 'profiles'), revisions: await readStore(page, 'resumeRevisions'), branches: await readStore(page, 'resumeBranches') };
      row.sessions = await readStore(page, 'agentSessions');
      row.status = 'PARTIAL'; // Transport completion is not a semantic or end-to-end PASS.
      row.confirmationCards = await page.locator('.agent-confirmation').count();
      row.pageText = await page.locator('main').textContent();
      await page.screenshot({ path: `docs/quality/rp01-logs/scenario-${scenario.scenario}.png`, fullPage: true });
    } catch (error) { row.status = 'BLOCKED'; row.error = String(error); await page.screenshot({ path: `docs/quality/rp01-logs/scenario-${scenario.scenario}-failure.png`, timeout: 5000 }).catch(() => undefined); }
    finally { save(); await context.close(); }
  }
  expect(results.every(row => row.status !== 'BLOCKED')).toBe(true);
});
