import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("product theme tokens", () => {
  it("defines light and dark product token scopes", () => {
    const css = readFileSync("src/styles/product-tokens.css", "utf8");
    expect(css).toContain(":root {");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("--product-app-bg:");
    expect(css).toContain("--product-control-compact: 32px");
    expect(css).toContain("--product-control-normal: 36px");
    expect(css).toContain("--product-control-prominent: 40px");
  });
});
