import { ROUTES_AREA, SIDEBAR_NAV_AREA } from "@hermes/plugin-sdk";
import { createElement, useState } from "react";

const plugin = {
  id: "careeradapt-transport-poc",
  name: "Career Transport Fixture",
  register(ctx) {
    function View() {
      const [result, setResult] = useState("Fixture only; no real data");
      async function run() {
        try {
          await ctx.rest("/open", { method: "POST" });
          const response = await ctx.rest("/rpc", { method: "POST", body: { apiVersion: 1, requestId: "ui-hello", method: "hello", scope: { workspaceId: "fixture-workspace", profileId: "fixture-profile" }, expectedServiceEpoch: null, payload: {} } });
          setResult(JSON.stringify(response));
        } catch (error) { setResult(String(error)); }
      }
      return createElement("article", { "aria-label": "Transport fixture" }, createElement("button", { onClick: run }, "Connect fixture"), createElement("pre", null, result));
    }
    ctx.registerMany([
      { id: "page", area: ROUTES_AREA, title: "Transport Fixture", data: { path: "/career-transport-fixture" }, render: () => createElement(View) },
      { id: "nav", area: SIDEBAR_NAV_AREA, data: { label: "Transport Fixture", path: "/career-transport-fixture", codicon: "plug" } }
    ]);
  }
};

export default plugin;
