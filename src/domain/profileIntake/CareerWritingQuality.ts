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
  const value = text.trim();
  return /^(?:来源事实[:：]|原始事实已保留|待进一步补充|待整理经历|暂无可靠内容)/u.test(value)
    || /^(?:根据(?:已确认|当前)(?:资料|事实|信息)|该经历(?:已|将)|以下(?:内容|信息)来自|资料库中(?:记录|已有))/u.test(value)
    || /(?:source\s*(?:fact|evidence)|placeholder|diagnostic|raw\s*transcript)/iu.test(value)
    || isRawOrNegativeSpeech(value)
    || /^(?:项目背景|项目描述|研究方法|工作内容|主要内容)[:：]?\s*$/u.test(value);
}

/** Speech-like, negative, or internal drafting language that must not reach a
 * professional resume even when the source fact itself is valid. */
export function isRawOrNegativeSpeech(text: string) {
  return /功能类似\s*DeepTutor\s*但较弱|它既可以|然后可以最后|一个人做|AI\s*辅助开发|看起来完整但不应直接展示/iu.test(text.trim());
}

/** Approximate semantic density used by the deterministic reviewer. */
export function semanticComponentCount(text: string) {
  let count = 0;
  if (/(?:负责|参与|协助|完成|实现|设计|开发|构建|搭建|优化|分析|清洗|组织|维护|主导|支持)/u.test(text)) count += 1;
  if (/[A-Za-z][A-Za-z0-9+#./-]*|(?:页面|流程|接口|模型|数据|设备|系统|平台|功能|工作流|交互|样本|自动化)/u.test(text)) count += 1;
  if (/(?:使用|基于|通过|采用|结合|调用|部署|联调|测试|开发)/u.test(text) && /[A-Za-z]/u.test(text)) count += 1;
  if (/(?:提升|降低|减少|增加|支持|产出|交付|上线|结果|成果|覆盖|完成度|准确率|效率)/u.test(text)) count += 1;
  return count;
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
