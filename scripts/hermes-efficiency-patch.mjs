/** Resolve the named timeout policy only for CareerAdapt's exact AMD route. */
export function patchCareerAdaptTimeoutLookup(source) {
  const marker = "# CareerAdapt named AMD timeout policy survives canonical custom provider IDs.";
  if (source.includes(marker)) return source;
  const anchor = '    providers = config.get("providers", {}) if isinstance(config, dict) else {}';
  if (source.split(anchor).length !== 3) throw new Error("Hermes timeout lookup shape changed");
  const helper = [marker,
    "def _careeradapt_timeout_key(provider_id, model, config):",
    "    from urllib.parse import urlsplit",
    '    if provider_id != "custom" or model != "Qwen3.8-27B":', "        return provider_id",
    '    model_config = config.get("model", {}) if isinstance(config, dict) else {}',
    '    base_url = model_config.get("base_url", "") if isinstance(model_config, dict) else ""',
    '    if urlsplit(base_url).hostname == "developer.amd.com.cn":',
    '        return "custom:careeradapt"', "    return provider_id", "", ""].join("\n");
  return source.replace("def _coerce_timeout(", helper + "def _coerce_timeout(")
    .replaceAll(anchor, '    provider_id = _careeradapt_timeout_key(provider_id, model, config)\n' + anchor);
}

/** Drop only a byte-for-byte/JSON-equivalent secondary MCP representation. */
export function patchCareerAdaptMcpDedup(source) {
  const marker = "            # CareerAdapt: one model-visible copy of identical MCP JSON.";
  if (source.includes(marker)) return source;
  const anchor = '            structured = getattr(result, "structuredContent", None)';
  if (source.split(anchor).length !== 2) throw new Error("Hermes MCP result shape changed");
  return source.replace(anchor, [anchor, marker,
    '            if server_name == "careeradapt" and structured is not None and text_result:',
    "                try:", "                    primary = json.loads(text_result)",
    '                    duplicate = isinstance(primary, dict) and isinstance(structured, dict) and {k: v for k, v in primary.items() if k != "diagnostics"} == {k: v for k, v in structured.items() if k != "diagnostics"}',
    "                except (json.JSONDecodeError, TypeError):", "                    duplicate = False",
    "                if duplicate:", '                    compact = {"result": text_result}',
    '                    if structured.get("diagnostics") != primary.get("diagnostics"):',
    '                        compact["structuredContent"] = {"diagnostics": structured.get("diagnostics")}',
    '                    return json.dumps(compact, ensure_ascii=False)'].join("\n"));
}
