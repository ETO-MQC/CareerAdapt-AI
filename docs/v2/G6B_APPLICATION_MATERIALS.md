# V2-G6b Application Materials And Interview Prep

## Actual Baseline

- Start gate on 2026-07-06:
  - `git status --short`: clean.
  - `git diff --stat`: clean.
  - `git diff --check`: clean.
  - `git log --oneline --decorate -15`: HEAD `20b87ef V2-G6a`; no `v2-g6a-complete` tag was present, but G6a completion was documented and committed.
  - `pnpm verify`: passed; 19 unit files, 117/117 tests, typecheck, lint and production build passed.
  - `pnpm test:c1:eval`: passed.
  - `pnpm test:c2:eval`: passed.
  - `pnpm test:e2e`: first full run timed out once at 184s, second full run completed with 142 passed, 1 skipped and 1 timeout in the existing G3a direct-PDF test. The failed test passed on focused repeat in 4.9s, recorded as baseline flaky.
- G6a focused E2E passed in the baseline full run.
- Dexie schema stayed v8. Package dependency stayed `dexie@4.4.4`.

## Scope

G6b adds a local application material pack for each existing `ApplicationRecord`:

```text
ApplicationRecord
-> selected job-specific ResumeBranch
-> selected ResumeRevision
-> current Job requirements and RequirementBlockMatch
-> ApplicationPreparationPack in appMeta
-> Application detail materials panel
```

This stage does not send email, create Gmail drafts, submit applications, call recruitment platforms, create calendar events, scrape company information, enter DOCX/OCR, or change Application status automatically.

## ApplicationPreparationPack

The pack uses `schemaVersion="application-preparation-v1"` and is stored in existing `appMeta` under:

```text
applicationPreparationPack:${applicationId}
```

No new Dexie table was added.

The pack stores:

- `applicationId`, `profileId`, `jobId`.
- `basedOn`: branch id, revision id, branch revision, presentation revision, requirements hash and optional export record id.
- typed materials:
  - `coverLetters.zh/en`
  - `applicationEmails.zh_brief/zh_formal/en_brief/en_formal`
  - `selfIntroductions.zh30/zh60/en30/en60`
  - `interviewQuestions[]`
  - `starStories[]`
- `factGaps`.
- `checklist`.
- pack `version`, `createdAt`, `updatedAt`.

The pack does not store PDF Blob, exported PDF bytes, full prompts, API keys, platform credentials, complete JD body as a new source of truth, or complete ResumeRevision text as duplicated long-term data.

## Context

`ApplicationPreparationContext` is built from real current data:

- `ApplicationRecord`
- `CareerProfile`
- `JobDescription`
- selected job-specific branch
- selected `ResumeRevision` snapshot
- existing `RequirementMatch`
- derived `RequirementBlockMatch`
- selected successful `ExportRecord` when present

Material generation uses the Application-selected revision snapshot, not the newest branch text. If the Application later selects another revision or requirements hash changes, older materials become `stale`.

## Materials

Implemented material types:

- Chinese and English cover letter.
- Chinese and English application email draft, brief and formal.
- Chinese and English self introduction, 30s and 60s.
- Interview question set with requirement-based, resume-based, verification and behavioral questions.
- STAR story from one resume block source.
- Fact gap list.

Generation is deterministic local fallback in this stage and validates output through Zod schemas. It does not depend on realtime AI. This keeps G6b E2E deterministic while leaving the schemas ready for a future provider-backed drafter.

## Fact Guard

Material guard is a thin adapter over existing `runRuleFactGuard`.

- It flattens material content to plain text.
- It compares against current selected resume facts plus neutral material template phrases and job title/company.
- It passes only confirmed `MatchEvidenceRef` values from the selected resume facts as user evidence.
- It does not treat JD requirements as user facts.
- It re-runs after user edits and before marking material complete.
- `blocked` and `needs_edit` materials cannot be marked completed.

Company and role names may come from the Job. Specific company business claims are not generated.

## Stale And History

Each material records:

- based-on revision id;
- branch revision;
- requirements hash;
- optional export record id;
- guard status and reasons;
- generation version;
- user edited flag;
- version history capped at 5 entries.

Revision or requirements changes mark old materials `stale`. Presentation-only changes do not mark materials stale. History restore re-runs material guard.

## Readiness

Application readiness now has two parts:

- existing delivery readiness: job, branch, revision, Fact Guard, page policy, export and diagnostics;
- material readiness from the pack checklist.

Material readiness can be `ready`, `needs_attention` or `blocked`. It does not set Application `ready`, does not set `applied`, and does not express hiring probability, interview probability, ATS score or pass rate.

## UI

Application detail includes a new materials panel:

- generate cover letter;
- edit cover letter;
- save draft;
- mark complete;
- mark not needed;
- restore cover letter history;
- generate email draft;
- generate self introduction;
- generate interview questions;
- mark question prepared;
- generate STAR story;
- inspect evidence refs;
- resolve or ignore fact gaps.

All displayed user text is rendered as React text. No HTML/script execution or arbitrary CSS is allowed.

## Privacy And Safety

- No original PDF is sent to AI.
- No generated email is sent.
- No Gmail/Calendar integration was added.
- No external company data service is called.
- Pack save rejects forbidden payload keys such as `pdfBlob`, `apiKey` and `prompt`, and common `sk-...` key shapes.
- Application status is not automatically changed by material generation, edit, completion or not-needed actions.

## Tests

Permanent tests added:

- `tests/unit/applicationPreparation.test.ts`
- `tests/unit/applicationMaterialGuards.test.ts`
- `tests/unit/applicationMaterialStale.test.ts`
- `tests/unit/applicationMaterialsReadiness.test.ts`
- `tests/unit/applicationPreparationFixtures.ts`
- `tests/e2e/v2-g6b-application-materials.spec.ts`

Checkpoint verification:

- G6b focused unit: 4 files, 13/13 passed.
- Full unit after G6b: 23 files, 130/130 passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- G6b focused E2E: 1/1 passed.
- G6a + G6b focused E2E: 2/2 passed.

Final verification:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 23 files, 130/130 passed.
- `pnpm build`: passed.
- G6b focused unit: 13/13 passed.
- G6b focused E2E: 1/1 passed.
- G6a + G6b focused E2E: 2/2 passed.
- G4 -> G5 -> G6 E2E chain: 17 passed, 1 skipped.
- `pnpm test:e2e`: 144 passed, 1 skipped.
- `pnpm test:c1:eval`: passed.
- `pnpm test:c2:eval`: passed.
- `pnpm verify`: passed.

## Bugs And Fixes

- Material guard initially treated fixed material boilerplate, company/job phrases and estimated duration metadata as unsupported facts. Fixed by adding a neutral material baseline and excluding non-factual metadata fields from material guard text.
- Pack privacy validation initially ran after Zod parsing, so unknown forbidden keys could be stripped before inspection. Fixed by checking the raw input pack before parsing.
- Existing `ApplicationReadiness` unit expectations were updated so the fully-ready scenario explicitly includes a ready material checklist.
- Full E2E initially exposed two existing G5 suggestion-accept timing flakes under parallel load. The G5 E2E assertions now wait for the persisted accepted suggestion before checking branch revision, without skipping or weakening the revision assertions.

## Known Limits

- The current G6b drafter is deterministic local fallback, not a live provider-backed AI generation path.
- Cover letter editing UI is implemented; email, introduction and STAR are generated/previewed and can be completed or marked not needed, but rich editors for each are future refinements.
- Fact gap resolution points to existing facts conceptually; no second fact editor was created.
- Only current single implicit profile UI is supported.
- No DOCX, OCR, Gmail, Calendar, external application submission or G7 work was started.
