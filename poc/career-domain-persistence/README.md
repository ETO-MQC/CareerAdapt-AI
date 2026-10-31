# P5.2.0-B isolated persistence spike

Status: PARTIAL; formal cutover and rollback after new writes BLOCKED. See the [ADR](../../docs/architecture/p5.2.0b-career-domain-persistence-adr.md) and [machine evidence](../../docs/architecture/p5.2.0b-career-domain-persistence-evidence.json).

No production data, service endpoint, plugin wiring or business mutation backend. The temporary target is a one-time immutable snapshot, not SQLite or a replacement WorkspaceRepository. The readback worker is a CLI, not a Domain Service. Existing Repository writes remain the only business authority.

Reproduce from repository root with existing dependencies and locked Hermes checkout available (HERMES_SOURCE_DIR optionally selects it):

```powershell
node poc/career-domain-persistence/audit.mjs
node poc/career-domain-persistence/build.mjs
pnpm exec vitest run tests/unit/p520b-persistence.test.ts
pnpm exec eslint poc/career-domain-persistence tests/unit/p520b-persistence.test.ts --max-warnings=0
pnpm typecheck
```

The fixture-only exporter refuses the default production database name. Tests retain isolated fake-indexeddb databases, OS temp snapshot directories and failed staging files. No cleanup script performs deletion. The build writes only `.artifacts/p520b/readback.mjs`; tests write `.tmp/p520b-migration-run.json`. The committed evidence contains only synthetic IDs/hashes/counts and test outcomes, not user data, credentials or machine absolute paths.
