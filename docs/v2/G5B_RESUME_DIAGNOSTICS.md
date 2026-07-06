# V2-G5b Resume Diagnostics

## Actual Baseline

- Started after G5a baseline passed: `pnpm verify`, full E2E, C1 eval and C2 eval all green.
- Current Dexie schema remains v7. No new table, no Dexie upgrade, no new dependency.
- Reused G5a `RequirementBlockMatch`, G3b `PaginationPlan`, `ResumePresentationConfig`, `ResumeRenderModel`, Template Registry metadata and the existing presentation save queue.

## Scope

G5b adds deterministic resume diagnostics for the current branch, target job, requirement coverage, content structure, layout tokens, DOM pagination measurement, template metadata and export state.

The diagnostic result is derived state, not a new fact source. It does not write `CareerProfile`, `ResumeBranch.contentItems`, `factRefs` or `ResumeRevision`.

## Rules

- Requirement coverage: required uncovered, weak required match, preferred weak/uncovered, hidden-only evidence, stale requirement matches, fact gaps and key evidence positioned late.
- Content: short/long blocks, duplicate text, missing sections, missing/invalid contact text, low-relevance large blocks and hidden strong matches.
- Layout and pagination: small+tight readability, tight gaps, hidden section titles, sparse second page, strict one-page overflow, exceeds-two-pages, oversized block, forced break whitespace and horizontal overflow.
- ATS structure: only reports product-observable structure risk. It does not claim third-party ATS certification, interview probability, hiring probability or guaranteed pass.
- Template fit: uses Template Registry category/layout/atsLevel/suitableRoles/tags/capabilities/default style to recommend a safer template with evidence.

## Snapshot And Staleness

Each snapshot binds:

- branch id, branch revision and current revision id;
- presentation revision, template id and page policy;
- requirements hash and pagination hash;
- diagnostics engine version, ruleset version and template registry version.

Changing content, presentation, template, page policy, pagination plan or requirements makes the existing snapshot stale. The UI supports manual re-run and debounced re-run after stable branch/presentation changes.

Issue ids are stable hashes of branch, template, category, code and target ids. Random ids are not used.

## Safe Actions

Safe actions are limited to presentation changes:

- density, body text scale, title scale, line height, section gap, item gap;
- page policy and section break cancellation;
- template switch;
- hide/show and same-section move up/down.

All safe actions are user-clicked, routed through the existing presentation queue, increase `presentationRevision`, support display undo/redo and do not create `ResumeRevision`.

Content problems only locate the block or point back to G5a/fact gap flows.

## UI

Resume Studio now includes a no-print diagnostics panel with:

- summary tiles for issue counts, coverage, pages, ATS structure and export hard-block state;
- category filters;
- issue cards with severity, evidence, targets, locate, ignore and recommended actions;
- stale state and error state.

The panel is `.no-print`, so it is excluded from browser print and direct PDF.

## Export Integration

`ExportRecord` has optional diagnostic summary fields:

- `diagnosticsEngineVersion`
- `diagnosticsSnapshotHash`
- `criticalIssueCount`
- `warningIssueCount`
- `requirementCoverageSummary`

These fields are optional and old records still parse. Diagnostic warnings do not block export. Hard blocking remains limited to existing official export gates such as invalid branch, failed measurement and page-policy overflow.

## Privacy And Safety

- No external AI call is used for G5b.
- No third-party ATS service is contacted.
- Diagnostics do not log full resume text or full JD.
- Ignored issue keys are stored in existing `appMeta`, scoped by branch.
- Diagnostic cache contains no original PDF Blob.

## Tests

- Unit: `tests/unit/resumeDiagnostics.test.ts`
- E2E: `tests/e2e/v2-g5b-resume-diagnostics.spec.ts`

Covered behavior includes snapshot stability/staleness, requirement gaps, hidden strong evidence, pagination hard block, ATS wording boundary, optional ExportRecord fields, UI entry, category filtering, locate action and presentation-only safe fix.

## Known Limits

- Current DOM measurement comes from the existing pagination measurement page; it does not start a separate headless browser for diagnostics.
- PDF text extraction diagnostics are limited to existing product guarantees and optional export record context; diagnostics do not regenerate PDFs.
- G5b does not implement DOCX, OCR, dnd-kit, Application, multiProfile, automatic content rewrite or one-click fix-all.
