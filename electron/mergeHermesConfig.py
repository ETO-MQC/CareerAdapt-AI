"""Merge only CareerAdapt-owned coordinates; preserve all other YAML values."""
import json
import sys

import yaml


class ConfigLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in result:
            raise ValueError("duplicate_config_key")
        result[key] = loader.construct_object(value_node)
    return result


ConfigLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


class ConfigDumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


class Quoted(str):
    pass


ConfigDumper.add_representer(Quoted, lambda dumper, value: dumper.represent_scalar("tag:yaml.org,2002:str", value, style='"'))


def mapping(value):
    if not isinstance(value, dict):
        raise ValueError("invalid_config_mapping")
    return value


def merge(existing, managed):
    result = dict(existing)
    old_model = result.get("model", {})
    if isinstance(old_model, str):
        old_model = {"default": old_model}
    model = {**mapping(old_model), **managed["model"]}
    model["default"] = Quoted(model["default"])
    # Keep the two hot-switch scalar targets first and unambiguous.
    model = {"default": model.pop("default"), **model}
    result["model"] = model
    if "custom_providers" in managed:
        providers = result.get("custom_providers", [])
        if not isinstance(providers, list) or any(not isinstance(p, dict) for p in providers):
            raise ValueError("invalid_custom_providers")
        owned = [p for p in providers if p.get("name") == "careeradapt"]
        if len(owned) > 1:
            raise ValueError("duplicate_careeradapt_provider")
        provider = {**(owned[0] if owned else {}), **managed["custom_providers"][0]}
        provider["model"] = Quoted(provider["model"])
        provider = {"name": provider.pop("name"), **provider}
        result["custom_providers"] = [provider, *[p for p in providers if p.get("name") != "careeradapt"]]
    toolsets = dict(mapping(result.get("platform_toolsets", {})))
    old_tools = toolsets.get("api_server", [])
    if not isinstance(old_tools, list) or any(not isinstance(t, str) for t in old_tools):
        raise ValueError("invalid_api_server_toolsets")
    toolsets["api_server"] = list(dict.fromkeys([*old_tools, *managed["platform_toolsets"]["api_server"]]))
    result["platform_toolsets"] = toolsets
    for section in ("mcp_servers", "gateway"):
        if section not in managed:
            continue
        old = dict(mapping(result.get(section, {})))
        for key, value in managed[section].items():
            old[key] = {**mapping(old.get(key, {})), **value} if isinstance(value, dict) else value
        result[section] = old
    return {"model": result.pop("model"), **({"custom_providers": result.pop("custom_providers")} if "custom_providers" in result else {}), **result}


try:
    payload = json.load(sys.stdin)
    existing = mapping(yaml.load(payload["existing"], Loader=ConfigLoader) or {})
    if payload.get("action") == "read_model":
        model = mapping(existing.get("model", {}))
        json.dump({"model": model.get("default"), "provider": model.get("provider"), "baseUrl": model.get("base_url")}, sys.stdout)
        sys.exit(0)
    managed = mapping(yaml.load(payload["managed"], Loader=ConfigLoader))
    result = merge(existing, managed)
    sys.stdout.write("# BEGIN CAREERADAPT MANAGED CONFIG\n# Coordinates managed by CareerAdapt; other values preserved.\n")
    sys.stdout.write(yaml.dump(result, Dumper=ConfigDumper, sort_keys=False, allow_unicode=True))
    sys.stdout.write("# END CAREERADAPT MANAGED CONFIG\n")
except (ValueError, TypeError, yaml.YAMLError):
    # Never emit parser exceptions: they can contain user values or credentials.
    sys.stderr.write("hermes_managed_config_invalid\n")
    sys.exit(1)
