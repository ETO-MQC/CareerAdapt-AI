---
name: resume-composition
description: Compile an evidence-grounded general or job-specific CareerAdapt resume from a confirmed CareerProfile using an evidence graph, blueprint, guarded professional writing, review, and explicit confirmation. Use when generating a new resume, previewing a composition proposal, recovering supported project technology, or evaluating job-keyword coverage.
---

# Resume composition

## PURPOSE

Turn a confirmed CareerProfile into a derived ResumeRevision. Keep Profile,
general Resume, and job-specific branches isolated. Use one composition path
for both `general` and `job_specific` modes.

## INPUTS

- `profileId` and `expectedProfileRevision`.
- `mode`: `general` or `job_specific`.
- Optional `jobId`, `sourceResumeId`, and user preferences.
- Confirmed structured facts, fact provenance, source excerpts, and any
  existing job requirement or fit context available through the host.

## WORKFLOW

1. Read the current Profile through the host boundary. Build a deterministic
   `ResumeEvidenceGraph` from confirmed facts, canonical `structuredFacts`,
   provenance, source excerpts, and cross-asset links. Do not mutate Profile.
2. Create a `ResumeBlueprint` proposal. Rank assets by evidence strength,
   relevance, uniqueness, and (in job mode) truthful requirement coverage.
   Prefer one page for an early-career profile and expose at most two optional
   information needs.
3. Show a compact proposal before writing: selected education/assets,
   derived skill groups, summary, project bullets, evidence gaps, and review
   findings. Offer `生成简历`, `调整内容`, `继续补充资料`, or cancellation.
4. Ask only optional, high-value questions. A missing metric, publication
   detail, or ambiguous author role must never block a safe draft; the user may
   choose direct generation.
5. On explicit confirmation, run the writer and reviewer, then persist only
   through `WorkspaceRepository` as an isolated `ResumeBranch`/revision.

## EVIDENCE AND WRITING RULES

- Classify every candidate claim as `SUPPORTED`, `DERIVED_PRESENTATION`,
  `NEEDS_USER_CONFIRMATION`, or `UNSUPPORTED`. Unsupported claims are held out
  of the resume; do not lower Fact Guard thresholds.
- Aggregate technical skills only from explicit, confirmed tools, methods, or
  source evidence. Preserve source asset IDs, fact IDs, excerpts, and turn IDs.
  Do not infer proficiency, ownership, metrics, or PostgreSQL from SQLite/SQLx.
- Preserve ownership wording such as `协助`, `参与`, and `共同负责`.
- Compile substantial projects into a header, optional tech-stack row, and
  two to four concise bullets. Do not persist recovered tools or author roles
  back to Profile automatically.
- Treat summaries and grouped skills as presentation-layer output. Avoid
  generic claims such as “学习能力强” unless supported and useful.
- Exclude placeholders, workflow controls, diagnostic/fallback text, negative
  absence statements, and empty generic `Other` items.

## JOB-SPECIFIC MODE

Classify each job keyword as `SUPPORTED`, `POTENTIALLY_SUPPORTED`, or
`UNSUPPORTED`. Use supported terminology only when the evidence supports the
same meaning. A neighboring technology may create a question or visible gap,
never a stuffed keyword. If the user confirms a new fact, ask whether it is
for this job branch only or should be explicitly synchronized to Profile.

## REVIEW AND OUTPUT

Run a separate reviewer pass for evidence support, ownership, relevance,
duplicates, vague wording, paragraphs, ATS coverage, section balance, and
one-page density. Cut low-relevance lines before changing safe typography.
Return the proposal/checkpoint before confirmation and the new resume/revision
only after confirmation. Preview and PDF remain derived from the persisted
revision; verify the text layer before export.

## TOOL BOUNDARY

Use `mcp__careeradapt__career_workflow_compose_resume` for the normal flow and
`mcp__careeradapt__career_resume_build_evidence_graph`,
`mcp__careeradapt__career_resume_plan_composition`,
`mcp__careeradapt__career_resume_review_composition`, or
`mcp__careeradapt__career_resume_compose` only for bounded
inspection/recovery. These are the exact Hermes v0.19 callable names; the
stable dotted CareerAdapt names are diagnostics aliases, not model calls.
Hermes/MCP never writes a repository directly. Profile synchronization is a
separate, explicit user action.

## STOP CONDITIONS

Stop at `waiting_for_confirmation` before a write, at `waiting_for_user` for
an optional question, or at `partial`/`failed` with the checkpoint and safe
error. Stop composition when the profile revision, job, source branch, or
session binding is stale; reread and replan rather than replaying a write.
