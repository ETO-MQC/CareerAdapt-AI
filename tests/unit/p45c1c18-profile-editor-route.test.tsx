import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProfileCategoryFields, type ProfileItemDraft } from "@/app/profile/ProfileWorkspace";
import { emptyStructuredExperienceFields, emptyStructuredProjectFields } from "@/domain/resumeFields/catalog";

describe("P4.5c.1.18 Profile route editor projection", () => {
  // jsdom has no layout observer; these tests verify content projection and rehydration.
  beforeAll(() => vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }));
  afterAll(() => vi.unstubAllGlobals());
  it("mounts one canonical description list with four entries and no duplicate legacy editor", async () => {
    const draft: ProfileItemDraft = {
      ...emptyStructuredExperienceFields,
      ...emptyStructuredProjectFields,
      projectFields: {
        ...emptyStructuredProjectFields,
        title: "项目",
        description: "",
        highlights: ["A", "B", "C", "D"],
        outcomes: []
      },
      title: "项目",
      subtitle: "",
      body: "",
      date: "",
      level: "familiar",
      experienceType: "work"
    };
    const { container } = render(
      <ProfileCategoryFields
        category="project"
        draft={draft}
        onChange={vi.fn()}
      />
    );

    const selector = '.string-list-editor[aria-label="描述逐条编辑"]';
    await waitFor(() => expect(container.querySelector(selector)).toBeTruthy());
    expect(container.querySelectorAll(selector).length).toBe(1);
    expect(container.querySelectorAll(`${selector} textarea`).length).toBe(4);
    expect(Array.from(container.querySelectorAll<HTMLTextAreaElement>(`${selector} textarea`)).map(item => item.value)).toEqual(["A", "B", "C", "D"]);
    expect(container.querySelectorAll('.tiptap-prosemirror').length).toBe(0);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"]').length).toBe(0);
  });

  it("rehydrates the same route editor when switching project A to B and back", async () => {
    const draft = (title: string, highlights: string[]): ProfileItemDraft => ({
      ...emptyStructuredExperienceFields,
      ...emptyStructuredProjectFields,
      projectFields: {
        ...emptyStructuredProjectFields,
        title,
        description: "",
        highlights,
        outcomes: []
      },
      title,
      subtitle: "",
      body: "",
      date: "",
      level: "familiar",
      experienceType: "work"
    });
    const { container, rerender } = render(
      <ProfileCategoryFields category="project" draft={draft("项目 A", ["A1", "A2"])} onChange={vi.fn()} />
    );

    await waitFor(() => expect(container.querySelector('.string-list-editor[aria-label="描述逐条编辑"]')).toBeTruthy());
    expect(Array.from(container.querySelectorAll<HTMLTextAreaElement>('.string-list-editor[aria-label="描述逐条编辑"] textarea')).map((item) => item.value)).toEqual(["A1", "A2"]);

    rerender(<ProfileCategoryFields category="project" draft={draft("项目 B", ["B1", "B2", "B3"])} onChange={vi.fn()} />);
    await waitFor(() => expect(Array.from(container.querySelectorAll<HTMLTextAreaElement>('.string-list-editor[aria-label="描述逐条编辑"] textarea')).map((item) => item.value)).toEqual(["B1", "B2", "B3"]));

    rerender(<ProfileCategoryFields category="project" draft={draft("项目 A", ["A1", "A2"])} onChange={vi.fn()} />);
    await waitFor(() => expect(Array.from(container.querySelectorAll<HTMLTextAreaElement>('.string-list-editor[aria-label="描述逐条编辑"] textarea')).map((item) => item.value)).toEqual(["A1", "A2"]));
  });
});
