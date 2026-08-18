import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructuredProjectForm } from "@/components/editor/StructuredProjectForm";
import { emptyStructuredProjectFields } from "@/domain/resumeFields/catalog";

describe("P4.5c.1.18 Profile route editor projection", () => {
  it("mounts one TipTap content editor with four visible bullets and no duplicate content textarea", async () => {
    const { container } = render(
      <StructuredProjectForm
        idPrefix="profile-project"
        value={{
          ...emptyStructuredProjectFields,
          title: "项目",
          description: "",
          highlights: ["A", "B", "C", "D"],
          outcomes: []
        }}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => expect(container.querySelector(".tiptap-prosemirror")).toBeTruthy());
    expect(container.querySelectorAll('[data-profile-editor="experience-content"]').length).toBe(1);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] .tiptap-prosemirror').length).toBe(1);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] ul > li').length).toBe(4);
    expect(container.querySelectorAll('[data-profile-editor="experience-content"] textarea').length).toBe(0);
  });
});
