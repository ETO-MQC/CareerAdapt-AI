import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
// The qualification scripts are plain Node modules, outside production bundling.
import { assertRp01RuntimeParity, careerSkillsTreeHash } from '../../scripts/rp01-preflight.mjs';

function fixture() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp011-preflight-synthetic-'));
  fs.cpSync('skills/career', path.join(runtimeRoot, 'skills/careeradapt'), { recursive: true });
  const manifest = { ...JSON.parse(fs.readFileSync('scripts/hermes-runtime-lock.json', 'utf8')), careerSkillsHash: careerSkillsTreeHash('skills/career') };
  fs.writeFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify(manifest));
  return runtimeRoot;
}

it('RP01 accepts all six exact Skills and rejects a stale bundle before credentials/network', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp01-preflight-synthetic-'));
  fs.writeFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync('scripts/hermes-runtime-lock.json', 'utf8')), careerSkillsHash: careerSkillsTreeHash('skills/career') }));
  const names = ['candidate-profile-interview', 'career-story-mining', 'job-fit-analysis', 'resume-composition', 'resume-review', 'resume-tailoring'];
  for (const name of names) {
    const folder = path.join(runtimeRoot, 'skills/careeradapt', name); fs.mkdirSync(folder, { recursive: true });
    fs.cpSync(path.join('skills/career', name), folder, { recursive: true });
  }
  for (const name of ['README.md', 'ATTRIBUTIONS.md']) fs.copyFileSync(path.join('skills/career', name), path.join(runtimeRoot, 'skills/careeradapt', name));
  expect(assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toHaveLength(6);
  fs.appendFileSync(path.join(runtimeRoot, 'skills/careeradapt/resume-review/SKILL.md'), '\nsynthetic stale marker\n');
  expect(() => assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toThrow(/stale bundled Skills: resume-review/);
});

it('rejects auxiliary file drift', () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, 'skills/careeradapt/resume-composition/agents/openai.yaml'), '\nstale');
  expect(() => assertRp01RuntimeParity(process.cwd(), root)).toThrow(/stale bundled Skills: resume-composition/);
});

it('rejects a missing Skill directory without deleting fixtures', () => {
  const root = fixture();
  fs.renameSync(path.join(root, 'skills/careeradapt/resume-review'), path.join(root, 'removed-review'));
  expect(() => assertRp01RuntimeParity(process.cwd(), root)).toThrow(/inventory mismatch/);
});

it('rejects unapproved extra Skills', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'skills/careeradapt/unapproved'));
  expect(() => assertRp01RuntimeParity(process.cwd(), root)).toThrow(/inventory mismatch/);
});

it('rejects a false manifest aggregate', () => {
  const root = fixture();
  const filename = path.join(root, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  manifest.careerSkillsHash = '0'.repeat(64);
  fs.writeFileSync(filename, JSON.stringify(manifest));
  expect(() => assertRp01RuntimeParity(process.cwd(), root)).toThrow(/careerSkillsHash/);
});

it('RP01 rejects runtime manifest mismatch before reading a Skill', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp01-manifest-synthetic-'));
  fs.writeFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), '{}');
  expect(() => assertRp01RuntimeParity(process.cwd(), runtimeRoot)).toThrow(/runtime manifest mismatch/);
});
