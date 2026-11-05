import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const careerSkillNames = ['candidate-profile-interview', 'career-story-mining', 'job-fit-analysis', 'resume-composition', 'resume-review', 'resume-tailoring'];

// Same path/NUL/content/NUL encoding as the official runtime builder.
// Skills include every file: auxiliary files are part of the runtime contract.
export function careerSkillsTreeHash(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`RP01 Skill symlink is not allowed: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new Error(`RP01 unsupported Skill entry: ${absolute}`);
    }
  }
  visit(root);
  const hash = createHash('sha256');
  for (const file of files.sort((a, b) => a.localeCompare(b, 'en'))) {
    hash.update(path.relative(root, file).split(path.sep).join('/')).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

function assertSkillInventory(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...careerSkillNames].sort()) || entries.some(entry => entry.isSymbolicLink() || (!entry.isDirectory() && !['README.md', 'ATTRIBUTIONS.md'].includes(entry.name)))) {
    throw new Error(`RP01 Skill inventory mismatch: ${names.join(', ')}`);
  }
}

export function assertRp01RuntimeParity(projectRoot, runtimeRoot) {
  if (!runtimeRoot) throw new Error('RP01 requires an explicit bundled runtime root');
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/hermes-runtime-lock.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), 'utf8'));
  for (const name of Object.keys(lock)) {
    if (manifest[name] !== lock[name]) throw new Error(`RP01 runtime manifest mismatch: ${name}`);
  }
  const sourceRoot = path.join(projectRoot, 'skills/career');
  const bundledRoot = path.join(runtimeRoot, 'skills/careeradapt');
  assertSkillInventory(sourceRoot);
  assertSkillInventory(bundledRoot);
  const rows = careerSkillNames.map(name => ({ name,
    sourceSha256: careerSkillsTreeHash(path.join(sourceRoot, name)),
    bundledSha256: careerSkillsTreeHash(path.join(bundledRoot, name)) }));
  const mismatch = rows.filter(row => row.sourceSha256 !== row.bundledSha256);
  if (mismatch.length) throw new Error(`RP01 stale bundled Skills: ${mismatch.map(row => row.name).join(', ')}; no provider requests allowed`);
  if (manifest.careerSkillsHash !== careerSkillsTreeHash(bundledRoot) || manifest.careerSkillsHash !== careerSkillsTreeHash(sourceRoot)) throw new Error('RP01 runtime manifest mismatch: careerSkillsHash; no provider requests allowed');
  return rows;
}
