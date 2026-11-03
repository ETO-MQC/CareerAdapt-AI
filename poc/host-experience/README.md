# P5.2.2 CareerAdapt Profile in Hermes Host

Slice 1 restores the original Profile information structure using only synthetic read-only data. The existing plugin ID and route are unchanged. Hermes owns the only global sidebar and all theme state.

```powershell
node scripts/p522-host-experience-build.mjs
node scripts/p522-gate00-qualification.mjs
node scripts/p522-slice1-host-smoke.mjs
```

Use the existing locked Hermes checkout at `%LOCALAPPDATA%/hermes/hermes-agent`, commit eb527605 / Runtime0.19.0 / Desktop0.17.0. Main/preload must already be built. Serve its actual renderer at 127.0.0.1:5174 using its existing root Vite installation; no install or Core modification is required. These tests launch real Electron with fresh isolated home/userData/plugin directories and an unreachable offline provider.

The build projects `src/data/demoProfile.ts` and explicit synthetic additions into `profile-fixture.json`. Only this display DTO, response schema, pure view, original Product components and scoped styles enter the renderer. The source fixture builder, canonical migrations, Repository, AI, OCR and PDF controllers do not enter the plugin bundle. Original Product CSS is scoped at build time, not imported globally. Host applied Light/Dark/System selects the original brand palette; there is no theme setter or provider in the plugin.

The page has person/version context, all 19 canonical categories, search/usage/archive filters, item selection, typed details and source evidence. Writes, import/export and person/version management are explicitly disabled. There is no additional Career sidebar, Chat, Pane or other business page entry.

Current test: `pnpm exec vitest run tests/unit/p522-host-experience.test.tsx tests/unit/p522-slice1-profile-projection.test.ts tests/unit/p520a-profile-plugin.test.tsx tests/unit/p520b2b2-profile-packaging.test.tsx tests/unit/profileCategories.test.ts`.

Evidence and original/Host screenshot comparison: `docs/architecture/evidence/p522-slice1/comparison.html`. Reports: `p5.2.2-gate00-host-qualification.md` and `p5.2.2-slice1-profile-faithful-restoration.md` in `docs/architecture/`. User visual acceptance is pending; this is not a production data migration.

The previous `p522-host-experience-smoke.mjs` targets the historical seven-section design and remains historical evidence, not the current Slice 1 acceptance script. The optional `pane-probe.tsx` remains unchanged and is not loaded by default; its old timeouts must not be rerun blindly.
