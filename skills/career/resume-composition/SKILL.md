---
name: resume-composition
description: Create or update an isolated general/base Resume from confirmed CareerProfile evidence, without a target Job or JD.
version: 1.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [resume, composition, general-resume, evidence, fact-safety]
    related_skills: [candidate-profile-interview, resume-review, resume-tailoring]
---

# Resume composition

## PURPOSE

Turn a confirmed CareerProfile into an isolated general/base ResumeRevision.
Keep Profile data separate from the derived Resume. Use Resume Tailoring for
any saved-job or external-target Resume.

## INPUTS

- `profileId` and `expectedProfileRevision`.
- `mode`: `general`.
- Optional `sourceResumeId` and user preferences when updating an existing
  general Resume.
- Confirmed structured facts, fact provenance, source excerpts, and any
  existing review context available through the host.

## WORKFLOW

1. Read the current Profile through the host boundary. Build a deterministic
   `ResumeEvidenceGraph` from confirmed facts, canonical `structuredFacts`,
   provenance, source excerpts, and cross-asset links. Do not mutate Profile.
2. Create a `ResumeBlueprint` proposal. Rank assets by evidence strength,
   relevance, and uniqueness for a general/base Resume.
   Prefer one page for an early-career profile and expose at most two optional
   information needs.
3. Show a compact proposal before writing: selected education/assets,
   derived skill groups, summary, project bullets, evidence gaps, and review
   findings. Offer `生成简历`, `调整内容`, `继续补充资料`, or cancellation.
4. Persist the exact graph/blueprint/writer output/reviewer result as an
   immutable `ResumeCompositionCheckpoint` before confirmation. Confirmation
   commits that checkpoint exactly; it must not invoke the Writer a second
   time. Regeneration, new evidence, or Profile revision changes create a new
   checkpoint.
5. Ask only optional, high-value questions. A missing metric, publication
   detail, or ambiguous author role must never block a safe draft; the user may
   choose direct generation.
6. On explicit confirmation, persist only the approved checkpoint through
   `WorkspaceRepository` as an isolated `ResumeBranch`/revision.

## EVIDENCE AND WRITING RULES

 - Record Writer execution (`ai` or `deterministic_fallback`) with provider,
   model, prompt version, attempt, latency, fallback reason, and context/output
   hashes. Never describe a fallback result as AI-generated.
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
 - Run one bounded repair pass for weak bullets, then Fact Guard and Reviewer
   again; retain fewer bullets when evidence cannot support a safe repair.
- Treat summaries and grouped skills as presentation-layer output. Avoid
  generic claims such as “学习能力强” unless supported and useful.
- Exclude placeholders, workflow controls, diagnostic/fallback text, negative
  absence statements, and empty generic `Other` items.

## REVIEW AND OUTPUT

Run a global reviewer pass for evidence support, ownership, relevance,
duplicates, vague wording, paragraphs, ATS evidence eligibility versus final
coverage, section balance, and one-page density. After the draft, perform one
bounded safe ATS repair for a supported-but-missing exact concept, then Fact
Guard, Reviewer, and ATS re-check. Cut low-relevance lines before changing
safe typography.
Return the proposal/checkpoint before confirmation and the new resume/revision
only after confirmation. Preview and PDF remain derived from the persisted
revision; verify the text layer before export.

## TOOL BOUNDARY

Use only `mcp__careeradapt__career_workflow_compose_resume` for general Resume
creation or update. It owns evidence eligibility, the review proposal, and
the explicit confirmation boundary, including
`generalResumeMode: "update_existing"` when an existing general Resume is
being improved. Hermes/MCP never writes a repository directly, and Profile
synchronization remains a separate explicit user action. Never call atomic
composition tools.

## STOP CONDITIONS

Stop at `waiting_for_confirmation` before a write, at `waiting_for_user` for
an optional question, or at `partial`/`failed` with the checkpoint and safe
error. Stop composition when the Profile revision, source branch, or session
binding is stale; reread and replan rather than replaying a write.
