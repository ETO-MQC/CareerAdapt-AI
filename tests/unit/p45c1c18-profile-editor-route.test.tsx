import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileCategoryFields, type ProfileItemDraft } from "@/app/profile/ProfileWorkspace";
import { emptyStructuredExperienceFields, emptyStructuredProjectFields } from "@/domain/resumeFields/catalog";

describe("P4.5c.1.18 Profile route editor projection", () => {
  it("mounts one TipTap content editor with four visible bullets and no duplicate content textarea", async () => {
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

    await waitFor(() => expect(container.querySelector(".tiptap-prosemirror")).toBeTruthy());
    expect(container.querySelectorAll('[data-profile-editor="experience-content"]').length).toBe(1);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] .tiptap-prosemirror').length).toBe(1);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] ul > li').length).toBe(4);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] textarea').length).toBe(0);
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

    await waitFor(() => expect(container.querySelector('[data-profile-editor="experience-content"]')).toBeTruthy());
    expect(Array.from(container.querySelectorAll('[data-profile-editor="experience-content"] li')).map((item) => item.textContent)).toEqual(["A1", "A2"]);

    rerender(<ProfileCategoryFields category="project" draft={draft("项目 B", ["B1", "B2", "B3"])} onChange={vi.fn()} />);
    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-profile-editor="experience-content"] li')).map((item) => item.textContent)).toEqual(["B1", "B2", "B3"]));

    rerender(<ProfileCategoryFields category="project" draft={draft("项目 A", ["A1", "A2"])} onChange={vi.fn()} />);
    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-profile-editor="experience-content"] li')).map((item) => item.textContent)).toEqual(["A1", "A2"]));
  });
});
