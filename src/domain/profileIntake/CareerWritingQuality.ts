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

const OWNERSHIP = /独立完成|独立负责|主要负责|共同完成|共同负责|协助|参与|参加|配合|支持|负责|主导|带领/gu;
const OWNERSHIP_LEVEL: Record<string, number> = { 协助: 1, 参与: 1, 参加: 1, 配合: 1, 支持: 1, 共同完成: 2, 共同负责: 2, 负责: 3, 主要负责: 4, 独立完成: 5, 独立负责: 5, 主导: 6, 带领: 6 };
function responsibilityClaims(text: string) {
  return text.split(/[。；;，,\n]/u).flatMap((clause) => [...clause.matchAll(OWNERSHIP)].map((match) => ({
    phrase: match[0], level: OWNERSHIP_LEVEL[match[0]],
    other: !/与|和|共同/u.test(clause.slice(0, match.index)) && /(?:团队|小组|负责人|同学|老师|他人|他们)[^我本人]*$/u.test(clause.slice(0, match.index)),
    object: clause.slice(match.index! + match[0].length).replace(/^(?:使用|通过|完成|了)/u, "").trim()
  })));
}
/** Summary for ranking only; never use this aggregate to authorize a claim. */
export function ownershipStrength(text: string) {
  return Math.max(0, ...responsibilityClaims(text).filter((claim) => !claim.other).map((claim) => claim.level));
}

/** Check each action against its own source scope, excluding other people's actions. */
export function preservesOwnership(sourceText: string, generatedText: string) {
  const sources = responsibilityClaims(sourceText);
  return responsibilityClaims(generatedText).every((claim) => sources.some((source) => {
    if (source.other !== claim.other || source.level < claim.level) return false;
    if (source.level <= 2 && source.phrase !== claim.phrase && !(["参与", "参加"].includes(source.phrase) && ["参与", "参加"].includes(claim.phrase))) return false;
    if (/[及和、]/u.test(claim.object) && !source.object.includes(claim.object)) return false;
    if (!source.object || !claim.object) return source.phrase === claim.phrase;
    const tokens = claim.object.match(/[A-Za-z][A-Za-z0-9.+#-]*|[\u4e00-\u9fff]{2}/gu) ?? [];
    return source.object.includes(claim.object) || claim.object.includes(source.object)
      || tokens.filter((token) => source.object.includes(token)).length >= Math.max(1, Math.ceil(tokens.length * 0.5));
  }));
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
