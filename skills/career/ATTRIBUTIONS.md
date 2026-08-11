# Attribution and provenance

The six skill documents remain CareerAdapt AI-authored. P4.4d adds Hermes
portable-skill metadata and explicit runtime boundaries; it does not copy
Hermes implementation or prompt text. P4.4b adapted
workflow patterns only; no third-party code, prompt text, template, personal
data, proprietary taxonomy, or external runtime is imported by this folder.

## P4.5b.3 upstream review record

The following current upstream files were reviewed on 2026-08-11. The commit
is recorded so the review is reproducible; no upstream file is vendored or
copied into this repository.

### MadsLorentzen/ai-job-search

- Upstream commit: `0dc0f562fcd6431182d8cd8e615190b1b901b2f0` (`master`).
- License: MIT.
- Reviewed: `.claude/skills/job-application-assistant/SKILL.md`.
- Concept adapted: fit evaluation before tailoring, profile/job/application
  workflow sequencing, and final document verification.
- CareerAdapt AI changes: replaced file-oriented Claude/LaTeX output with
  Resume Schema v2, Evidence Graph/Blueprint, confirmed local facts,
  isolated job branches, and WorkspaceRepository revisions.

### vignzpie/resume-agent-skills

- Upstream commit: `d21f62ec07966a6f9b7963c5d1d8c736265d8393` (`main`).
- License: MIT.
- Reviewed: `career-profile-builder/SKILL.md` and
  `resume-tailor/SKILL.md`.
- Concept adapted: durable profile as source of truth, profile preflight,
  achievements/gaps/approved framing, targeted discovery, ATS pass, render,
  compression, and no-fabrication/ownership calibration.
- CareerAdapt AI changes: profile truth remains separate from job branches;
  targeted discovery is evidence-backed and confirmation-gated, and the
  writer/reviewer/export pipeline is deterministic and revision-bound.

### dabydat/resume-builder-skill

- Upstream commit: `bf6355fd226410c4028124ec14f711bbe87b52d3` (`master`).
- License: MIT.
- Reviewed: `skill/SKILL.md` and its documented reference workflow.
- Concept adapted: domain context, action/impact bullet structure, ATS-safe
  layout, text extraction and page-count verification.
- CareerAdapt AI changes: translated the guidance into Chinese Resume Schema
  v2 semantic components, fact-source guards, early-career one-page budgeting,
  and snapshot-based PDF coverage diagnostics; no Harvard wording or template
  was copied.

### Paramchoudhary/ResumeSkills

- Upstream commit: `74ae19e7c62b0516d1c298328e5544976c12da5d` (`main`).
- License: MIT.
- Reviewed: `skills/resume-ats-optimizer/SKILL.md`,
  `skills/resume-bullet-writer/SKILL.md`, and
  `skills/resume-tailor/SKILL.md`.
- Concept adapted: modular ATS/bullet/tailoring stages, exact keyword checks,
  section and bullet prioritization, and explicit truthful-tailoring rules.
- CareerAdapt AI changes: canonical grouped skill projection, semantic density
  and raw-speech review, target-context composition, and no unsupported
  keyword insertion; the upstream skill files are not imported.

### Non-derivative conceptual references

- `agentenatalie/get-job.skill` — CC BY-NC-ND; reviewed only for the concept
  of a staged job-search/resume workflow. No text, code, or asset is copied.
- `shangsitongshizaitiantang/industry-resume-toolkit` — CC BY-NC-ND;
  reviewed only for industry-aware resume framing. No text, code, or asset is
  copied, and neither repository is vendored.

## Adapted sources

### MadsLorentzen/ai-job-search

- Source: <https://github.com/MadsLorentzen/ai-job-search>
- License: MIT (`LICENSE` in the source repository).
- Reviewed: `.claude/commands/setup.md`, `.claude/commands/apply.md`,
  `.claude/skills/job-application-assistant/SKILL.md`, and `CLAUDE.md`.
- Adapted here: bounded profile setup, one-question evidence gathering,
  visible gaps, fit-before-tailoring, reviewer/revise sequencing, proposal
  before write, evidence-backed resume composition, and final render/text-layer
  verification.
- Changes: rewritten for Resume Schema v2, deterministic local Evidence Graph
  and Resume Blueprint, local source evidence, explicit confirmation,
  WorkspaceRepository writes, and isolated job branches. No source prose,
  implementation, LaTeX template, or personal data was copied.

### yanliudesign/offer-toolkit-skill

- Source: <https://github.com/yanliudesign/offer-toolkit-skill>
- License: MIT (repository `LICENSE`).
- Reviewed: top-level `SKILL.md`, `job-description-skill/SKILL.md`, and the
  repository README rules.
- Adapted here: decode-before-match, one-question-at-a-time interaction,
  never-fabricate discipline, and structure-before-render sequencing.
- Changes: reduced to CareerAdapt AI's evidence matrix and confirmation
  boundaries; no HTML report, template, or prompt bundle was copied.

### yanliudesign/job-description-skill

- Source: <https://github.com/yanliudesign/job-description-skill>
- License: MIT (repository license statement).
- Reviewed: `SKILL.md` and the documented decode/match/gap/should-I-apply
  workflow.
- Adapted here: requirement decoding, explicit must/nice separation, gap
  visibility, and fit-before-tailoring order in `job-fit-analysis`.
- Changes: output remains a structured CareerAdapt AI job analysis rather
  than the upstream HTML report; no upstream report assets were copied.

## Studied but not imported

### NousResearch/hermes-agent

- Source: <https://github.com/NousResearch/hermes-agent>
- License: MIT.
- Studied for P4.4b runtime boundaries: long-lived gateway/session behavior,
  skills, persistent state, RPC/tool callbacks, and server-side companion
  deployment. The Hermes adapter and bridge in this repository are original;
  no Hermes source was copied.

- Skill authoring reference: <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/creating-skills.md>.
  Reviewed for frontmatter, bounded descriptions, and portable `SKILL.md`
  structure only; no source text was copied.

Keep this file updated with the source URL, license, reviewed paths, and exact
adaptation whenever a future revision adds another external methodology.
