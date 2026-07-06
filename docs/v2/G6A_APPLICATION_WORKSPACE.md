# V2-G6a Application Workspace

## Actual Baseline

- Start gate passed on 2026-07-06:
  - `git status --short`: clean.
  - `git diff --stat`: clean.
  - `git diff --check`: clean.
  - `pnpm verify`: passed, unit 105/105 and production build passed.
  - `pnpm test:e2e`: 143 total, 142 passed, 1 skipped, 0 failed.
  - `pnpm test:c1:eval`: passed, `overallQualified=true`, `hardSafetyFailures=0`.
  - `pnpm test:c2:eval`: passed, `safeAllowed=6`, `safeBlocked=0`, `unsafeBlocked=10`, `unsafeAllowed=0`, `workflowTests=108/108`, `overallQualified=true`.
- Previous G4a/G5a/G5b joint acceptance is frozen in `history2.md`.
- Dexie before this goal: v7.

## Scope

G6a adds local Application management for job opportunities and delivery workflow:

```text
job-specific ResumeBranch
-> explicit "加入投递工作台"
-> ApplicationRecord
-> /applications board/list/detail
-> status, dates, notes, timeline, readiness, export link
```

This stage does not implement automatic application submission, recruitment platform automation, email sending, reminders, multi Profile UI, DOCX, OCR, cover letters or interview AI.

## Application Model

`ApplicationRecord` is stored in `applications` and uses `schemaVersion="application-v1"`.

It stores:

- `profileId`, `jobId`.
- job title and company snapshots.
- source general branch id when the job-specific branch was derived from a general branch.
- job-specific branch id.
- selected `ResumeRevision`, branch revision, presentation revision, template id and page policy.
- selected `ExportRecord` id and light diagnostic summary when available.
- status, priority, source channel, source URL, dates, note and tags.
- applied snapshot after status becomes `applied`.
- embedded timeline events.
- independent Application `version`.

It does not store:

- full resume text as a new source of truth;
- full JD body;
- PDF Blob;
- API keys;
- recruitment platform cookies or login state;
- complete AI inputs.

## Dexie v8 Migration

Dexie schema now has v8 with exactly one new table:

```text
applications: id, profileId, jobId, jobSpecificBranchId, status, updatedAt, [profileId+status]
```

No existing table primary key changed. Existing v7 profile, job, branch, revision and export data is preserved. Empty database creation directly at v8 is covered by unit tests.

## Repository

`WorkspaceRepository` now owns all Application writes:

- `createApplicationFromBranch`
- `getApplication`
- `listApplicationsByProfile`
- `getApplicationContext`
- `getApplicationReadiness`
- `updateApplicationStatus`
- `updateApplicationDetails`
- `linkApplicationRevision`
- `attachApplicationExport`
- `archiveApplication`
- `restoreApplication`
- `listExportRecordsForBranch`

All writes use `expectedVersion`, `operationId` and Dexie transactions. Idempotency is recorded through embedded timeline events; no extra events table was added.

The repository validates:

- profile exists;
- job exists;
- branch exists and is `job_specific`;
- branch belongs to the same profile and job;
- selected revision belongs to the branch;
- export record belongs to the same branch, revision and branch revision;
- duplicate active Application for the same profile/job/branch is not silently created;
- illegal status transitions are rejected;
- applied snapshot locks the delivered revision/export reference.

## Status Machine

Primary path:

```text
discovered -> preparing -> ready -> applied -> interviewing -> offer
```

Other paths:

- `applied/interviewing -> rejected`
- any active non-archived status can move to `withdrawn`
- active statuses can move to `archived`
- archived applications restore to the previous status or `preparing`

Exporting a PDF, setting dates or creating an Application never changes status automatically.

## Board, List And Detail

Route: `/applications`.

The workspace supports:

- board view grouped as opportunity, preparing, applied, interviewing and result;
- list view with company, role, status, priority, revision, template, page count, deadline, follow-up and update time;
- filters for status, priority, source channel, PDF state, readiness and archived records;
- debounced local search over company, job title, tags and notes;
- sorting by updated time, deadline, follow-up, priority and created time.

The detail panel supports:

- job and resume links;
- status updates;
- priority, source channel, source URL, dates, tags and notes;
- selected revision and template display;
- latest revision selection before application is applied;
- latest export attachment;
- PDF regeneration from an existing export snapshot;
- applied version lock display;
- archive and restore;
- embedded timeline.

Cards and list rows do not render full resume text or full JD body.

## Readiness

Readiness is computed on detail open. It is not persisted as a permanent fact.

Levels:

- `blocked`
- `needs_attention`
- `ready`

Checklist items include:

- job existence;
- job-specific branch validity;
- selected revision validity;
- Fact Guard hard blockers;
- page policy/export hard blockers;
- successful export record;
- diagnostic summary.

Warnings do not become hiring probability, interview probability, ATS score or ATS pass rate.

## Resume Studio Link

Resume Studio now has an explicit Application entry on a selected branch:

- `job_specific` branch: creates or opens the related Application.
- `general` branch: disabled with a prompt to derive a job-specific branch first.
- Creation does not edit the branch, create a new revision, increment presentation revision, call AI or export PDF.
- `/resume?branchId=...` selects the linked branch from Application detail.

## PDF Link

Application stores only an `ExportRecord` reference. It does not store PDF Blob.

Detail actions:

- attach latest successful ExportRecord for the selected revision;
- regenerate/download PDF using the existing direct PDF API and the linked export snapshot;
- write a new `ExportRecord`;
- attach the new record to the Application timeline.

If no reusable export snapshot exists, the user must return to Resume Studio and export through the existing G3a/G3b pipeline.

## Damaged References

The detail context is loaded defensively. Missing job, branch, revision or export records produce readable blocked/needs-attention readiness items instead of a white screen.

No automatic cross-job or cross-profile guessing is performed. Applications are not permanently deleted in this stage.

## Privacy And Safety

- Source URL is stored as plain text and validated as `http` or `https`; the app does not fetch it.
- Notes and tags are rendered as React text, not HTML.
- Common API-key shaped text in notes/tags is redacted before storage.
- Timeline summaries do not include full resume body or full JD text.
- Application UI is `.no-print` and not part of the resume PDF.
- Fact Guard was not modified.
- No automatic submission, email sending, calendar event, platform login, browser extension or external job scraping was added.

## Tests

Permanent tests added:

- `tests/unit/application.test.ts`
- `tests/unit/applicationMigration.test.ts`
- `tests/unit/applicationReadiness.test.ts`
- `tests/e2e/v2-g6a-application-workspace.spec.ts`

Final verification:

- `pnpm verify`: passed; typecheck, lint, 117/117 unit tests and production build all passed.
- `pnpm test:e2e`: passed; 143/144 passed, 1 skipped SQL fixture.
- G6a focused E2E: 1/1 passed.
- `pnpm test:c1:eval`: passed; `overallQualified=true`, `hardSafetyFailures=0`.
- `pnpm test:c2:eval`: passed; `safeAllowed=6`, `safeBlocked=0`, `unsafeBlocked=10`, `unsafeAllowed=0`, `workflowTests=108/108`, `overallQualified=true`.
- `git diff --check`: no whitespace errors, only CRLF normalization warnings.

## Known Limits

- This is single implicit profile UI, consistent with the current `profiles[0]` baseline. Full multi Profile UI remains future G6/G7 work.
- Application detail can regenerate PDFs only when an existing export snapshot is available.
- There is no full reminder notification system, Gmail/Calendar integration, application materials package, interview prep, DOCX or OCR.

## Follow-Up Boundary

G6a itself did not start application material packages, reminders or interview preparation. G6b has now been implemented as a separate local `ApplicationPreparationPack` layer stored in `appMeta`; it reuses the G6a `ApplicationRecord` without changing the G6a status machine, Dexie `applications` table, PDF lock semantics or automatic-submission boundary.
