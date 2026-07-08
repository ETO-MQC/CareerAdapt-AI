# CareerAdapt AI Product Context

CareerAdapt AI helps candidates turn confirmed profile facts and target-job requirements into safe, editable resume branches and application preparation materials.

## Product Priorities

- Keep the MVP vertical loop clear: profile facts, job requirements, resume branch, A4 preview, export, and application workspace.
- Resume Studio is the primary commercial workspace for resume editing, job optimization, style control, preview, and export.
- AI suggestions are drafts. They must never overwrite resume content until the user explicitly accepts them and Fact Guard validation passes.
- New facts must be confirmed before they enter resume preview or PDF export.
- The interface should feel professional, calm, compact, and low-friction for repeated resume editing work.

## Current Scope

V2-G7b.3 focuses on:

- "我的简历" resume entry action hierarchy.
- Resume Studio edit, AI optimization, and style modes.
- A4 preview visibility and direct editing.
- Section navigation and current-section editing.
- Style inspection using existing templates, color, typography, and pagination controls.

## Non-Goals

- Do not change product positioning, core data responsibilities, or technology stack.
- Do not add another runtime UI framework.
- Do not alter Fact Guard thresholds, PDF export semantics, ResumeRevision semantics, or Dexie tables without explicit approval.
