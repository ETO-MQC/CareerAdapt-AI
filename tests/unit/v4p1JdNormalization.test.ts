import { describe, expect, it } from "vitest";
import {
  JD_CONTENT_HASH_ALGORITHM,
  JD_NORMALIZER_VERSION,
  canonicalizeJobSourceUrl,
  companyTitleFingerprint,
  contentFingerprint,
  decodeHtmlEntities,
  jdContentHash,
  normalizeJd,
  titleWithoutSalary
} from "@/domain/jobAssets/jdNormalization";

describe("V4-P1 stage 1: JD normalization and content hash", () => {
  it("collapses line endings, in-line whitespace, and blank runs while keeping line order", () => {
    expect(normalizeJd("职责一\r\n职责二\r职责三")).toBe("职责一\n职责二\n职责三");
    expect(normalizeJd("a  b\tc")).toBe("a b c");
    expect(normalizeJd("第一段\n\n\n\n第二段")).toBe("第一段\n\n第二段");
    expect(normalizeJd("  首行  \n\n\n 尾行 ")).toBe("首行\n\n尾行");
  });

  it("trims leading and trailing blank lines but keeps interior structure for sourceSpan", () => {
    expect(normalizeJd("\n\n\n职责：\n1. 开发\n\n\n")).toBe("职责：\n1. 开发");
    expect(normalizeJd("")).toBe("");
    expect(normalizeJd("   \n  \n")).toBe("");
  });

  it("removes soft hyphens and decodes the supported HTML entity set", () => {
    expect(normalizeJd("inter\u00ADnational experience")).toBe("international experience");
    expect(normalizeJd("R&amp;D 团队 &lt;5人 &nbsp;薪资面议")).toBe("R&D 团队 <5人 薪资面议");
    expect(decodeHtmlEntities("&#x4e2d;&#25991; 实体")).toBe("中文 实体");
  });

  it("keeps unknown entities and malformed numeric refs verbatim instead of guessing", () => {
    expect(decodeHtmlEntities("&unknownent; &#zz; &#xzz;")).toBe("&unknownent; &#zz; &#xzz;");
    expect(decodeHtmlEntities("&#0;")).toBe("&#0;");
  });

  it("produces identical hashes for inputs that normalize to the same content", () => {
    const raw = "职责：\r\n1. 后端开发\r\n\r\n\r\n要求：\n1. Go";
    const variant = "职责：\n1. 后端开发\n\n要求：   \n1. Go";
    expect(normalizeJd(raw)).toBe(normalizeJd(variant));
    expect(jdContentHash(raw)).toBe(jdContentHash(variant));
    expect(jdContentHash(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when content actually changes and versions the algorithm", () => {
    expect(jdContentHash("职责 A")).not.toBe(jdContentHash("职责 B"));
    expect(JD_CONTENT_HASH_ALGORITHM).toBe("sha256-normalized-v1");
    expect(JD_NORMALIZER_VERSION).toBe("careeradapt-jd-normalizer-v1");
  });

  it("strips only an exact trailing salary copy from the title", () => {
    expect(titleWithoutSalary("Agent开发实习 200-250元/天", "200-250元/天")).toBe("Agent开发实习");
    expect(titleWithoutSalary("200-250元/天", "200-250元/天")).toBe("200-250元/天");
    expect(titleWithoutSalary("薪资 300 的岗位", "300元/天")).toBe("薪资 300 的岗位");
    expect(titleWithoutSalary(" 高级工程师 ", null)).toBe("高级工程师");
    expect(titleWithoutSalary("Agent开发实习·200-250元/天", "200-250元/天")).toBe("Agent开发实习");
  });

  it("computes stable company/title/content fingerprints with case folding", () => {
    expect(companyTitleFingerprint("Go 工程师", "某公司"))
      .toBe(companyTitleFingerprint(" go 工程师 ", "某公司"));
    expect(contentFingerprint("Go 工程师", "某公司", "正文"))
      .toBe(contentFingerprint("go 工程师", "某公司", " 正文 "));
    expect(contentFingerprint("A", "B", "正文")).not.toBe(contentFingerprint("B", "A", "正文"));
    expect(contentFingerprint("A", "B", "正文")).not.toBe(companyTitleFingerprint("A", "B"));
  });

  it("canonicalizes source URLs with explainable rules", () => {
    expect(canonicalizeJobSourceUrl("HTTPS://Jobs.Example.com:443/p/123?utm_source=board&id=9&b=2&a=1#top"))
      .toBe("https://jobs.example.com/p/123?a=1&b=2&id=9");
    expect(canonicalizeJobSourceUrl("http://jobs.example.com:80/x")).toBe("http://jobs.example.com/x");
    expect(canonicalizeJobSourceUrl("https://jobs.example.com/p?z=1&utm_medium=x&Z=2")).toBe("https://jobs.example.com/p?z=1&Z=2");
    expect(canonicalizeJobSourceUrl("   https://jobs.example.com/p  ")).toBe("https://jobs.example.com/p");
  });

  it("refuses non-http protocols, bare strings, and empty input", () => {
    expect(canonicalizeJobSourceUrl("javascript:alert(1)")).toBeUndefined();
    expect(canonicalizeJobSourceUrl("ftp://jobs.example.com/x")).toBeUndefined();
    expect(canonicalizeJobSourceUrl("not a url")).toBeUndefined();
    expect(canonicalizeJobSourceUrl("")).toBeUndefined();
  });
});
