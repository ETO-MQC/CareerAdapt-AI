import { expect, test, type Page } from "@playwright/test";
import { fullAiTemplateFixture } from "../fixtures/resume-v2/fullAiTemplate";

type CanonicalEntry = { data: { id: string; sectionType: string } };
type DbProfile = { id: string; name: string; version: number; structuredFacts?: CanonicalEntry[] };
type DbBranch = { id: string; profileId: string; revision: number; sourceImportId?: string; structuredContentItems?: Array<{ visible: boolean; data: { id: string; sectionType: string } }> };
type DbAppMeta = { key: string; value?: { sections?: Array<{ sectionType: string; included: boolean; items: Array<{ included: boolean }> }> } };

const expected = new Map<string, number>([
  ["summary", 1], ["education", 1], ["work", 2], ["project", 4],
  ["awards", 2], ["skills", 6], ["languages", 1]
]);

test.describe("P3.6g0.3 canonical Profile and Studio library", () => {
  test("import → profile library → canonical counts", async ({ page }) => {
    const profileName = `P36g02 Import ${Date.now()}`;
    await importCanonicalJson(page, profileName, true);

    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    const profiles = await readStore<DbProfile>(page, "profiles");
    const profile = profiles.find((item) => item.name === profileName)!;
    const branches = await readStore<DbBranch>(page, "resumeBranches");
    const branch = branches.find((item) => item.profileId === profile.id && item.sourceImportId)!;
    expectCanonicalCounts(profile.structuredFacts?.map((entry) => entry.data) ?? []);
    expectCanonicalCounts(branch.structuredContentItems?.filter((item) => item.visible).map((item) => item.data) ?? []);

    await page.goto("/profile");
    const categoryList = page.getByRole("listbox", { name: "资料分类" });
    await expect(categoryList).toBeVisible();
    const canonicalOrder = ["basics", "summary", "education", "work", "internship", "project", "research", "campus", "volunteer", "awards", "skills", "certificates", "languages", "publications", "patents", "portfolio", "other", "custom"];
    await expect(categoryList.locator("button")).toHaveCount(canonicalOrder.length);
    expect(await categoryList.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-section-type")))).toEqual(canonicalOrder);
    for (const [sectionType, count] of [["awards", 2], ["skills", 6], ["languages", 1]] as const) {
      await expect(categoryList.locator(`[data-section-type='${sectionType}'] b`)).toHaveText(String(count));
      await categoryList.locator(`[data-section-type='${sectionType}']`).click();
      await expect(page.locator(".profile-managed-row")).toHaveCount(count);
    }

    await page.goto(`/resume?branchId=${branch.id}`);
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();

    for (const [label, sectionType, count] of [
      ["奖项", "awards", 2], ["专业技能", "skills", 6], ["语言", "languages", 1]
    ] as const) {
      await page.getByTestId("resume-section-nav").getByRole("button", { name: new RegExp(label) }).click();
      await expect(page.getByTestId("resume-active-section-fields").locator(".accordion-item")).toHaveCount(count);
      const activeItems = await page.getByTestId("resume-active-section-fields").locator(".accordion-item").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-content-item-id"))
      );
      expect(activeItems).toHaveLength(count);
      expect(branch.structuredContentItems?.filter((item) => item.visible && item.data.sectionType === sectionType)).toHaveLength(count);
    }
  });

  test("library picker → ResumeBranch → refresh", async ({ page }) => {
    const profileName = `P36g02 Library ${Date.now()}`;
    await importCanonicalJson(page, profileName, false);
    await page.getByRole("button", { name: "从零创建" }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();

    for (const [label, itemCount] of [["专业技能", 6], ["奖项", 2], ["语言", 1]] as const) {
      await ensureSection(page, label);
      for (let index = 0; index < itemCount; index += 1) {
        const fields = page.getByTestId("resume-active-section-fields");
        await fields.getByRole("button", { name: "资料库", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: new RegExp(`从资料库选择${label}`) });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "使用", exact: true }).first().click();
        await expect(fields.locator(".accordion-item")).toHaveCount(index + 1);
      }
    }

    const branchBefore = (await readStore<DbBranch>(page, "resumeBranches")).sort((a, b) => b.revision - a.revision)[0];
    expect(branchBefore.revision).toBe(9);
    expectCanonicalCounts(branchBefore.structuredContentItems?.filter((item) => item.visible).map((item) => item.data) ?? [], new Map([
      ["awards", 2], ["skills", 6], ["languages", 1]
    ]));
    await page.reload();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    const branchAfter = (await readStore<DbBranch>(page, "resumeBranches")).find((item) => item.id === branchBefore.id)!;
    expect(branchAfter.revision).toBe(9);
    expectCanonicalCounts(branchAfter.structuredContentItems?.filter((item) => item.visible).map((item) => item.data) ?? [], new Map([
      ["awards", 2], ["skills", 6], ["languages", 1]
    ]));
  });
});

async function importCanonicalJson(page: Page, profileName: string, createGeneralResume: boolean) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify(resumeWithExpectedCounts()));
  await dialog.getByRole("button", { name: "导入JSON", exact: true }).click();
  await expect(dialog.locator(".import-structure-panel")).toBeVisible({ timeout: 20_000 });
  const importDraft = (await readStore<DbAppMeta>(page, "appMeta")).find((entry) => entry.key.startsWith("importedResumeDraft:"))?.value;
  for (const [sectionType, count] of expected) {
    const reviewCount = importDraft?.sections
      ?.filter((section) => section.included && section.sectionType === sectionType)
      .reduce((sum, section) => sum + section.items.filter((item) => item.included).length, 0);
    expect(reviewCount, `review:${sectionType}`).toBe(count);
  }
  await dialog.getByLabel("创建新人物").check();
  await dialog.locator("input[name='new-profile-name']").fill(profileName);
  const createResume = dialog.locator("input[name='import-create-general-resume']");
  if ((await createResume.isChecked()) !== createGeneralResume) await createResume.click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.locator(".app-notification-success").filter({ hasText: "导入成功" }).last()).toBeVisible({ timeout: 20_000 });
}

function resumeWithExpectedCounts() {
  return {
    ...fullAiTemplateFixture,
    basics: { ...fullAiTemplateFixture.basics, name: "P36g02 Candidate" },
    sections: fullAiTemplateFixture.sections.map((section) => {
      const count = expected.get(section.sectionType) ?? section.items.length;
      return {
        ...section,
        items: Array.from({ length: count }, (_, index) => ({
          ...section.items[0],
          id: `${section.sectionType}-p36g02-${index + 1}`
        }))
      };
    })
  };
}

async function ensureSection(page: Page, label: string) {
  const nav = page.getByTestId("resume-section-nav");
  const sectionButton = nav.locator(".resume-section-nav > button").filter({ hasText: label });
  if (!(await sectionButton.count())) {
    await nav.getByRole("button", { name: "添加栏目", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "添加或管理简历栏目" });
    await menu.getByRole("button", { name: new RegExp(label) }).click();
    await menu.getByRole("button", { name: "关闭添加栏目" }).click();
  }
  await nav.locator(".resume-section-nav > button").filter({ hasText: label }).click();
}

function expectCanonicalCounts(items: Array<{ sectionType: string }>, counts = expected) {
  for (const [sectionType, count] of counts) {
    expect(items.filter((item) => item.sectionType === sectionType), sectionType).toHaveLength(count);
  }
}

async function readStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate((name) => new Promise<T[]>((resolveRows, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, "readonly");
      const getAll = tx.objectStore(name).getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => resolveRows(getAll.result as T[]);
      tx.oncomplete = () => db.close();
    };
  }), storeName);
}
