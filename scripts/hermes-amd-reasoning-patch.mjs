/** Pinned-source patch. No provider defaults or output limits change outside Radeon Qwen. */
export function patchAmdReasoningTransport(source) {
  const marker = "# CareerAdapt AMD Qwen reasoning: top-level wire parameter.";
  if (source.includes(marker)) return source;
  const anchor = "def _reasoning_config_for_model(";
  if (source.split(anchor).length !== 2 || source.split("        return api_kwargs").length !== 3) throw new Error("Hermes AMD transport shape changed");
  const helper = [marker,
    "def careeradapt_amd_reasoning(api_kwargs, params):",
    "    from urllib.parse import urlsplit",
    '    if urlsplit(params.get("base_url") or "").hostname != "developer.amd.com.cn" or api_kwargs.get("model") != "Qwen3.8-27B":',
    "        return api_kwargs",
    '    config = params.get("reasoning_config")',
    "    if config is None:", "        return api_kwargs",
    '    effort = config.get("effort") if isinstance(config, dict) else None',
    '    if config.get("enabled") is False or effort not in {"low", "medium", "xhigh"}:',
    '        raise ValueError("careeradapt_amd_reasoning_effort_unsupported")',
    '    api_kwargs["reasoning_effort"] = effort',
    '    if isinstance(api_kwargs.get("extra_body"), dict):',
    '        api_kwargs["extra_body"].pop("reasoning", None)',
    '        if not api_kwargs["extra_body"]:', '            api_kwargs.pop("extra_body")',
    "    return api_kwargs", "", ""].join("\n");
  // Replace the two original return sites before inserting the helper's own returns.
  return source.replaceAll("        return api_kwargs", "        return careeradapt_amd_reasoning(api_kwargs, params)")
    .replace(anchor, helper + anchor);
}

export function patchAmdReasoningSummary(source) {
  const marker = "# CareerAdapt AMD summary uses the same resolved reasoning policy.";
  if (source.includes(marker)) return source;
  let result = source;
  for (const reason of ["iteration_limit_summary", "iteration_limit_summary_retry"]) {
    const anchor = `                summary_response = agent._ensure_primary_openai_client(reason="${reason}").chat.completions.create(**summary_kwargs)`;
    if (result.split(anchor).length !== 2) throw new Error("Hermes AMD summary shape changed");
    result = result.replace(anchor, ["                " + marker,
      "                from agent.transports.chat_completions import careeradapt_amd_reasoning",
      '                careeradapt_amd_reasoning(summary_kwargs, {"base_url": agent.base_url, "reasoning_config": agent.reasoning_config})', anchor].join("\n"));
  }
  return result;
}
