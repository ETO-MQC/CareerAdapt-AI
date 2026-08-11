# Third-party notices

P4.4d uses original CareerAdapt AI code and prompts. The following open-source
projects were reviewed for workflow or runtime design. No source code, prompt
text, report template, or personal data was copied into the product.

## NousResearch/hermes-agent

- Repository: <https://github.com/NousResearch/hermes-agent>
- License: MIT.
- Use in this project: architectural study only. The browser-safe Hermes
  bridge, server proxy, fallback router, and CareerToolGateway integration
  are original CareerAdapt AI implementation. Hermes skill-authoring guidance
  was reviewed from the official developer guide; the six skill files remain
  CareerAdapt AI-authored.

## MadsLorentzen/ai-job-search

- Repository: <https://github.com/MadsLorentzen/ai-job-search>
- License: MIT.
- Use in this project: workflow patterns adapted into
  `skills/career/`—bounded setup, fit-before-tailoring, reviewer/revise
  sequencing, final artifact verification, and P4.5b's proposal-before-write
  resume composition flow. See
  `skills/career/ATTRIBUTIONS.md` for reviewed paths and changes.

## P4.5b.3 resume-skill review record

These repositories were reviewed at the listed upstream commits. CareerAdapt
AI adapted concepts only; it did not copy their skill files, prompt text,
templates, examples, or personal data.

### vignzpie/resume-agent-skills

- Repository: <https://github.com/vignzpie/resume-agent-skills>
- Commit: `d21f62ec07966a6f9b7963c5d1d8c736265d8393` (`main`).
- License: MIT.
- Paths: `career-profile-builder/SKILL.md`, `resume-tailor/SKILL.md`.
- Adapted: profile preflight, durable evidence/gap/framing model, targeted
  discovery, ATS/render/compression stages, and truthful ownership rules.
- CareerAdapt changes: Resume Schema v2, evidence provenance, human
  confirmation, general/job branch isolation, revision-bound snapshot export.

### dabydat/resume-builder-skill

- Repository: <https://github.com/dabydat/resume-builder-skill>
- Commit: `bf6355fd226410c4028124ec14f711bbe87b52d3` (`master`).
- License: MIT.
- Path: `skill/SKILL.md`.
- Adapted: domain context, action/impact bullets, ATS-safe single-column
  principles, text-layer and page-count verification.
- CareerAdapt changes: Chinese semantic bullet rubric, fact guards, early-
  career one-page budget, and render coverage diagnostics/self-healing.

### Paramchoudhary/ResumeSkills

- Repository: <https://github.com/Paramchoudhary/ResumeSkills>
- Commit: `74ae19e7c62b0516d1c298328e5544976c12da5d` (`main`).
- License: MIT.
- Paths: `skills/resume-ats-optimizer/SKILL.md`,
  `skills/resume-bullet-writer/SKILL.md`,
  `skills/resume-tailor/SKILL.md`.
- Adapted: modular ATS, bullet-writing, and tailoring checks with exact
  keyword placement and truthfulness constraints.
- CareerAdapt changes: one canonical skill projection, semantic-density and
  negative-speech gates, target-direction context, and no fact invention.

### CC BY-NC-ND conceptual references

- <https://github.com/agentenatalie/get-job.skill> — concept review only;
  no derivative text/code/assets and no vendoring.
- <https://github.com/shangsitongshizaitiantang/industry-resume-toolkit> —
  concept review only; no derivative text/code/assets and no vendoring.

## yanliudesign/offer-toolkit-skill

- Repository: <https://github.com/yanliudesign/offer-toolkit-skill>
- License: MIT.
- Use in this project: evidence-first, one-question, decode-before-match, and
  structure-before-render patterns adapted into `skills/career/`.

## yanliudesign/job-description-skill

- Repository: <https://github.com/yanliudesign/job-description-skill>
- License: MIT.
- Use in this project: requirement decoding, must/nice separation, explicit
  gap reporting, and fit-before-tailoring order. No upstream HTML assets or
  prompts were imported.
