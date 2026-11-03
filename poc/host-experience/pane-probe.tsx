import { PANES_AREA, type HermesPlugin } from "@hermes/plugin-sdk";
import css from "./experience.css";

/** Optional capability probe, installed ONLY into the isolated test home. */
const plugin: HermesPlugin = {
  id: "careeradapt-pane-probe-p522", name: "CareerAdapt Pane Probe", defaultEnabled: true,
  register(ctx) {
    ctx.registerMany([{ id: "artifact", area: PANES_AREA, title: "CareerAdapt · Synthetic Artifact", data: { placement: "right", dock: { pane: "workspace", pos: "right" }, width: "360px", minWidth: "320px", maxWidth: "50vw", collapsible: true }, render: () => <div className="ca-experience" aria-label="CareerAdapt Synthetic Artifact"><style data-ca-pane-probe="">{css}</style><section className="ca-artifact"><h2>合成职业资料摘要</h2><p>仅验证 Host Pane，未绑定真实会话或任务产物。</p>{Array.from({ length: 20 }, (_, i) => <p key={i}>合成来源 {i + 1} · 此内容不是工具执行结果。</p>)}</section></div> }]);
  }
};
export default plugin;
