import { describe, expect, it } from "vitest";
import { patchModelSelectionReadback } from "../../scripts/hermes-model-selection-patch.mjs";

describe("locked Hermes selection readback patch", () => {
  const source = [
    "        auth_err = self._check_auth(request)",
    "        if auth_err:",
    "            return auth_err",
    "        try:",
    "            from hermes_cli.inventory import build_model_options_payload, load_picker_context",
    "            def _build_payload() -> Dict[str, Any]:",
    "                return build_model_options_payload(load_picker_context())"
  ].join("\n");

  it("keeps authentication ahead of selection and the existing inventory branch intact", () => {
    const result = patchModelSelectionReadback(source);
    expect(result.indexOf("self._check_auth")).toBeLessThan(result.indexOf('request.query.get("selection_only")'));
    expect(result.indexOf("return web.json_response")).toBeLessThan(result.indexOf("def _build_payload"));
    expect(result).toContain("context = await asyncio.to_thread(load_picker_context)");
    expect(result).toContain('"model": context.current_model');
    expect(result).toContain('"provider": context.current_provider');
    expect(result).toContain("return build_model_options_payload(load_picker_context())");
    expect(patchModelSelectionReadback(result)).toBe(result);
  });

  it("fails explicitly when the pinned upstream shape changes", () => {
    expect(() => patchModelSelectionReadback("changed handler")).toThrow("handler shape changed");
    expect(() => patchModelSelectionReadback(source + source)).toThrow("handler shape changed");
  });
});
