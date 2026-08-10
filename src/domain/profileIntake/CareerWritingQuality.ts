/** Small, local writing-quality helpers.  They are intentionally lexical:
 * CareerAdapt does not need a vector database to remove repeated bullets. */

export function dedupeCareerWriting(values: string[], sourceText = "") {
  const kept: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || isFiller(value)) continue;
    const duplicateIndex = kept.findIndex((candidate) => writingOverlap(candidate, value) >= 0.72);
    if (duplicateIndex < 0) {
      kept.push(value);
      continue;
    }
    // Keep the more informative version when the same action was restated.
    if (writingTokens(value).length > writingTokens(kept[duplicateIndex]).length) kept[duplicateIndex] = value;
  }
  void sourceText;
  return kept;
}

export function writingOverlap(left: string, right: string) {
  const leftFingerprint = writingFingerprint(left);
  const rightFingerprint = writingFingerprint(right);
  if (leftFingerprint && rightFingerprint && (leftFingerprint.includes(rightFingerprint) || rightFingerprint.includes(leftFingerprint))) return 1;
  const a = new Set(writingTokens(left));
  const b = new Set(writingTokens(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

export function ownershipStrength(text: string) {
  const levels = [
    ["协助|参与|配合|支持", 1],
    ["共同完成|共同负责", 2],
    ["主要负责", 3],
    ["负责", 4],
    ["独立完成|独立负责", 5],
    ["主导|带领", 6]
  ] as const;
  let strength = 0;
  for (const [pattern, level] of levels) {
    if (new RegExp(pattern, "iu").test(text)) strength = Math.max(strength, level);
  }
  return strength;
}

/** A generated line may not strengthen the ownership stated by the source. */
export function preservesOwnership(sourceText: string, generatedText: string) {
  const sourceStrength = ownershipStrength(sourceText);
  const generatedStrength = ownershipStrength(generatedText);
  return generatedStrength === 0 || (sourceStrength > 0 && generatedStrength <= sourceStrength);
}

export function isFiller(text: string) {
  return /^(?:来源事实[:：]|原始事实已保留|待进一步补充|待整理经历|暂无可靠内容)/u.test(text.trim());
}

function writingTokens(text: string) {
  return (text.toLocaleLowerCase().match(/[a-z][a-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,8}|\d+(?:\.\d+)?%?/gu) ?? [])
    .filter((token, index, all) => all.indexOf(token) === index);
}

function writingFingerprint(text: string) {
  return text.toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/(?:并且|并|且|以及|和)/gu, "");
}
