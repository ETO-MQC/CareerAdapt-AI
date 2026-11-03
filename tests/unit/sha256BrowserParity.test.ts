import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Utf8 } from "@/domain/jobAssets/sha256";
import { companyTitleFingerprint, contentFingerprint, jdContentHash, normalizeJd } from "@/domain/jobAssets/jdNormalization";

const reference = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("browser SHA-256 preserves persisted JD hash v1", () => {
  it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(1000), "中文🙂\u0000\ud800", "a".repeat(1_000_000)])("matches the Node UTF-8 oracle for vector %#", (text) => {
    expect(sha256Utf8(text)).toBe(reference(text));
  });
  it("matches published empty and abc vectors", () => {
    expect(sha256Utf8("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Utf8("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("preserves normalization, case folding, separator, sync return and hex encoding", () => {
    const raw = "职责：\r\n处理 R&amp;D 数据\u00ad\n\n\n要求： Go🙂";
    expect(jdContentHash(raw)).toBe(reference(normalizeJd(raw)));
    expect(companyTitleFingerprint(" Straße 工程师 ", " Acme ")).toBe(reference("strasse 工程师␟acme"));
    expect(contentFingerprint(" Straße 工程师 ", " Acme ", raw)).toBe(reference(`strasse 工程师␟acme␟${normalizeJd(raw)}`));
    expect(typeof jdContentHash(raw)).toBe("string");
  });
});
