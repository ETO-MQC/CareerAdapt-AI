import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
// The qualification scripts are plain Node modules, outside production bundling.
import { assertRp01RuntimeParity } from '../../scripts/rp01-preflight.mjs';

it('RP01 accepts all six exact Skills and rejects a stale bundle before credentials/network', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp01-preflight-synthetic-'));
  fs.copyFileSync('scripts/hermes-runtime-lock.json', path.join(runtimeRoot, 'runtime-manifest.json'));
  const names = ['candidate-profile-interview', 'career-story-mining', 'job-fit-analysis', 'resume-composition', 'resume-review', 'resume-tailoring'];
  for (const name of names) {
    const folder = path.join(runtimeRoot, 'skills/careeradapt', name); fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(path.join('skills/career', name, 'SKILL.md'), path.join(folder, 'SKILL.md'));
  }
  expect(assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toHaveLength(6);
  fs.appendFileSync(path.join(runtimeRoot, 'skills/careeradapt/resume-review/SKILL.md'), '\nsynthetic stale marker\n');
  expect(() => assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toThrow(/stale bundled Skills: resume-review/);
});

it('RP01 rejects runtime manifest mismatch before reading a Skill', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp01-manifest-synthetic-'));
  fs.writeFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), '{}');
  expect(() => assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toThrow(/runtime manifest mismatch/);
});
