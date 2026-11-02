import type { ProfileSnapshot } from "../profile-plugin/read-client";
import { syntheticProfile } from "./fixture";

export interface ProfileReadClient { getProfile(): Promise<unknown> }
export const fakeProfileReadClient: ProfileReadClient = Object.freeze({
  async getProfile() { return structuredClone(syntheticProfile); }
});

export class InvalidProfileResponse extends Error {
  constructor() { super("合成资料响应格式无效"); this.name = "InvalidProfileResponse"; }
}

/** Validate the client boundary before rendering. No coercion or fabricated fields. */
export function parseProfile(value: unknown): ProfileSnapshot | null {
  if (value === null) return null;
  const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  const text = (v: unknown): v is string => typeof v === "string";
  if (!object(value) || !text(value.id) || !text(value.name) || !Array.isArray(value.basics) || !Array.isArray(value.sections)
    || !value.basics.every(v => Array.isArray(v) && v.length === 2 && v.every(text))
    || !value.sections.every(s => object(s) && text(s.id) && text(s.label) && Array.isArray(s.items)
      && s.items.every(i => object(i) && [i.id, i.title, i.subtitle, i.body].every(text)))) throw new InvalidProfileResponse();
  return value as ProfileSnapshot;
}
