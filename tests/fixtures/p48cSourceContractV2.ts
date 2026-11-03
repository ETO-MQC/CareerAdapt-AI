import { corpusBullets, corpusProfile } from "./p48cCorpus";

/** v2: a strong original must have matching, confirmed original provenance.
 * v1's backend/infra mismatch is preserved in Git and B1/B2 failure evidence;
 * independent source-contract tests continue to require verification for it.
 */
export function strongOriginalProfileV2() {
  return corpusProfile([corpusBullets.infra]);
}
