/** Keep runtime configuration verification independent of the interactive catalog. */
export function patchModelSelectionReadback(source) {
  const marker = "            # CareerAdapt selection-only readback: no catalog discovery or pricing.";
  if (source.includes(marker)) return source;
  const anchor = "            def _build_payload() -> Dict[str, Any]:";
  if (source.split(anchor).length !== 2) throw new Error("Hermes model-options handler shape changed; selection patch not applied");
  return source.replace(anchor, [
    marker,
    '            if _coerce_request_bool(request.query.get("selection_only"), default=False):',
    "                context = await asyncio.to_thread(load_picker_context)",
    "                return web.json_response({",
    '                    "model": context.current_model,',
    '                    "provider": context.current_provider,',
    '                    "selection_only": True,',
    "                })",
    "",
    anchor
  ].join("\n"));
}
