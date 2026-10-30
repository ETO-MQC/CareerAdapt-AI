/** Shared writing/review semantics; does not replace the host's evidence or write gates. */
export const claimSafetyV2 = [
  "Claim Safety v2: missing from Profile means unknown, never inability. Judge whether wording exceeds supplied or explicitly user-confirmed information, not whether identical words already appear in Profile.",
  "source_confirmed and user_confirmed are legitimate evidence. An explicit supplied current-conversation declaration needs no uploaded proof or project provenance. Preserve its exact source turn, target, revision and maturity; never fabricate a declaration or evidence reference.",
  "transferable supports adjacent capability, not an unconfirmed tool; exploratory may only prompt clarification. learning/familiar permits accurate coursework, basic knowledge or exposure wording, never proficiency, project delivery or ownership.",
  "Block high_risk_unsupported education, employer, role, dates, credentials, awards, numbers, team size, ownership and business results; preserve conflicting user data and all existing rule findings. JD requirements and suggested examples are never candidate evidence.",
  "Natural supported synonyms and job-specific language are allowed without exact Profile keyword identity. Confirmed declarations default to resume_only; resume_and_profile requires a separate explicit reviewed user choice. Content confirmation never bypasses proposal approval, Repository, CAS or target/revision checks."
].join("\n");
