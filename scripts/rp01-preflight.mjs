import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function assertRp01RuntimeParity(projectRoot, runtimeRoot) {
  if (!runtimeRoot) throw new Error('RP01 requires an explicit bundled runtime root');
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/hermes-runtime-lock.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), 'utf8'));
  for (const name of Object.keys(lock)) {
    if (manifest[name] !== lock[name]) throw new Error(`RP01 runtime manifest mismatch: ${name}`);
  }
  const names = ['candidate-profile-interview', 'career-story-mining', 'job-fit-analysis', 'resume-composition', 'resume-review', 'resume-tailoring'];
  const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const rows = names.map(name => ({ name,
    sourceSha256: digest(path.join(projectRoot, 'skills/career', name, 'SKILL.md')),
    bundledSha256: digest(path.join(runtimeRoot, 'skills/careeradapt', name, 'SKILL.md')) }));
  const mismatch = rows.filter(row => row.sourceSha256 !== row.bundledSha256);
  if (mismatch.length) throw new Error(`RP01 stale bundled Skills: ${mismatch.map(row => row.name).join(', ')}; no provider requests allowed`);
  return rows;
}
