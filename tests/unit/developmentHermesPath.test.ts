import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { developmentHermesBundleRoot } from "../../scripts/development-hermes-path.mjs";

it("selects a stable development bundle and changes it when the lock or Skills change", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "careeradapt-dev-runtime-"));
  fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(project, "scripts", "hermes-runtime-lock.json"), '{"version":"1"}');
  fs.mkdirSync(path.join(project, "skills", "career", "example"), { recursive: true });
  const skill = path.join(project, "skills", "career", "example", "SKILL.md");
  fs.writeFileSync(skill, "first");
  const initial = developmentHermesBundleRoot(project);
  expect(developmentHermesBundleRoot(project)).toBe(initial);
  fs.mkdirSync(initial, { recursive: true });
  fs.writeFileSync(path.join(initial, "incomplete"), "preserve");
  expect(developmentHermesBundleRoot(project)).toBe(`${initial}-1`);
  expect(fs.readFileSync(path.join(initial, "incomplete"), "utf8")).toBe("preserve");
  fs.writeFileSync(skill, "second");
  const updatedSkill = developmentHermesBundleRoot(project);
  expect(updatedSkill).not.toBe(initial);
  fs.writeFileSync(path.join(project, "scripts", "hermes-runtime-lock.json"), '{"version":"2"}');
  expect(developmentHermesBundleRoot(project)).not.toBe(updatedSkill);
});
