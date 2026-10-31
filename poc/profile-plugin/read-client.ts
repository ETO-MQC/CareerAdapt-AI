import { canonicalProfileBasics, canonicalProfileLibraryItems, profileSectionCatalog } from "../../src/domain/profile/canonicalLibrary";
import type { CareerProfile } from "../../src/domain/schemas";

export type ProfileSnapshot = Readonly<{
  id: string;
  name: string;
  basics: ReadonlyArray<readonly [string, string]>;
  sections: ReadonlyArray<Readonly<{ id: string; label: string; items: ReadonlyArray<Readonly<{ id: string; title: string; subtitle: string; body: string }>> }>>;
}>;
export interface CareerDomainReadClient { readCurrentProfile(): ProfileSnapshot }

/** Pure projection; no Repository, Dexie, network or mutation capability. */
export function createCareerDomainReadClient(source: CareerProfile): CareerDomainReadClient {
  const profile = structuredClone(source);
  return Object.freeze({ readCurrentProfile() {
    const basics = canonicalProfileBasics(profile);
    const items = canonicalProfileLibraryItems(profile);
    return Object.freeze({
      id: profile.id,
      name: basics.name || profile.name,
      basics: Object.freeze(Object.entries(basics).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1])).map(([key, value]) => Object.freeze([key, value] as const))),
      sections: Object.freeze(profileSectionCatalog.filter(section => section.id !== "basics").map(section => Object.freeze({
        id: section.id, label: section.label,
        items: Object.freeze(items.filter(item => item.sectionType === section.id).map(({ id, title, subtitle, body }) => Object.freeze({ id, title, subtitle, body })))
      })).filter(section => section.items.length))
    });
  } });
}
