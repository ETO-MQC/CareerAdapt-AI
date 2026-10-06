/**
 * V4-P1 阶段 1：JD 标准化与内容哈希。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo — domain/job_discovery/models.py
 * (normalize_jd / jd_content_hash / title_without_salary / content_fingerprint /
 * company_title_fingerprint)。
 *
 * 迁移约束（v4-plan.md §7.1）：
 * - rawText 永远不被覆盖：本模块只读入字符串、产出派生值，rawText 由调用方持有；
 * - hash 算法与 normalizer 都带版本号，快照落库时必须同时记录两者；
 * - HTML 实体、换行、软连字符的处理在此定义并有测试；
 * - URL canonicalization 规则可解释（见 canonicalizeJobSourceUrl）。
 */

import { createHash } from "node:crypto";

export const JD_NORMALIZER_VERSION = "careeradapt-jd-normalizer-v1";
export const JD_CONTENT_HASH_ALGORITHM = "sha256-normalized-v1";
export const JOB_FINGERPRINT_ALGORITHM = "sha256-fingerprint-v1";
export const JOB_SOURCE_URL_CANONICALIZATION_VERSION = "careeradapt-job-url-v1";

/** 字段分隔符（U+241F SYMBOL FOR UNIT SEPARATOR），与 MyCareer 指纹格式一致。 */
const FINGERPRINT_SEPARATOR = "␟";

/**
 * decodeHtmlEntities 处理的实体集合：XML 五个核心实体、最常见命名实体与
 * 十进制/十六进制数字引用。刻意保持最小集合——JD 不是 HTML 文档，完整
 * 实体表属于抓取器职责，不属于内容规范化。
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "·",
  bull: "•"
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_HTML_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * normalizeJd v1：
 * 1. 删除软连字符 U+00AD（跨行断词的产物，不属于内容）；
 * 2. 解码 HTML 实体（最小集合，未识别实体原样保留）；
 * 3. CRLF/CR → LF；
 * 4. 行内空白折叠为单空格并去除首尾空白；
 * 5. 连续空行折叠为单个空行，整体 trim。
 * 原文的段落结构与行序保留，sourceSpan 才能回到原文。
 */
export function normalizeJd(description: string): string {
  const withoutSoftHyphen = description.replace(/\u00AD/gu, "");
  const decoded = decodeHtmlEntities(withoutSoftHyphen);
  const lines = decoded
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim());
  const normalized: string[] = [];
  let previousBlank = true;
  for (const line of lines) {
    const blank = !line;
    if (blank && previousBlank) continue;
    normalized.push(line);
    previousBlank = blank;
  }
  return normalized.join("\n").trim();
}

/** sha256(normalizeJd(description))，十六进制小写。 */
export function jdContentHash(description: string): string {
  return createHash("sha256").update(normalizeJd(description), "utf8").digest("hex");
}

/**
 * 剥离招聘板渲染进标题字段末尾的薪资副本（如「Agent开发实习 200-250元/天」）。
 * 只有标题以薪资字段原样结尾时才移除；只是提到钱的标题不受影响；
 * 标题等于薪资本身时保留原标题而不产生空串。
 */
export function titleWithoutSalary(title: string, salary: string | null | undefined): string {
  const stripped = title.trim();
  const wage = (salary ?? "").trim();
  if (!wage || !stripped.endsWith(wage)) return stripped;
  const remainder = stripped.slice(0, -wage.length).replace(/[ \t·|-–—,，]+$/u, "");
  return remainder || stripped;
}

/**
 * content 级指纹：大小写折叠的标题 + 公司 + 规范化正文。
 * jsCasefold 与 Python casefold() 的差异：JS 没有 casefold；这里用
 * toLowerCase 加上最常见的强折叠（ß→ss）近似，对 CJK/ASCII 指纹输入等价。
 */
function jsCasefold(value: string): string {
  return value.toLowerCase().replace(/ß/gu, "ss");
}

export function contentFingerprint(title: string, companyName: string, description: string): string {
  const value = [jsCasefold(title).trim(), jsCasefold(companyName).trim(), normalizeJd(description)]
    .join(FINGERPRINT_SEPARATOR);
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** company+title 级指纹：不含正文，用于三级去重的第二级。 */
export function companyTitleFingerprint(title: string, companyName: string): string {
  const value = [jsCasefold(title).trim(), jsCasefold(companyName).trim()]
    .join(FINGERPRINT_SEPARATOR);
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const TRACKING_QUERY_PREFIXES = ["utm_"];

/**
 * URL canonicalization v1（可解释规则，全部有测试）：
 * 1. protocol 与 host 小写；
 * 2. 去掉 http/https 的默认端口；
 * 3. 去掉 fragment；
 * 4. 移除 tracking 参数（utm_ 前缀），其余 query 参数按名称排序保留；
 * 5. 无法解析的输入返回 undefined（由调用方决定拒绝或按原样处理）。
 * 不做路径折叠、不做短链展开——那些需要网络访问，不属于纯逻辑。
 */
export function canonicalizeJobSourceUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "http:" && parsed.port === "80")
    || (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = "";
  }
  parsed.hash = "";
  const params = [...parsed.searchParams.entries()]
    .filter(([name]) => !TRACKING_QUERY_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix)))
    .sort(([left], [right]) => left.localeCompare(right));
  parsed.search = "";
  for (const [name, value] of params) parsed.searchParams.append(name, value);
  return parsed.toString();
}
