# Attribution and provenance

The five skill documents remain CareerAdapt AI-authored. P4.4d adds Hermes
portable-skill metadata and explicit runtime boundaries; it does not copy
Hermes implementation or prompt text. P4.4b adapted
workflow patterns only; no third-party code, prompt text, template, personal
data, proprietary taxonomy, or external runtime is imported by this folder.

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
