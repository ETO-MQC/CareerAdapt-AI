import { ROUTES_AREA, SIDEBAR_NAV_AREA, type HermesPlugin } from "@hermes/plugin-sdk";
import { CareerExperience } from "./CareerExperience";

export const manifest = { id: "careeradapt-experience-p522", name: "CareerAdapt", defaultEnabled: true };
export const EXPERIENCE_ROUTE = "/careeradapt-experience";
const plugin: HermesPlugin = {
  ...manifest,
  register(ctx) {
    ctx.registerMany([
      { id: "experience", area: ROUTES_AREA, title: manifest.name, data: { path: EXPERIENCE_ROUTE }, render: () => <CareerExperience /> },
      { id: "navigation", area: SIDEBAR_NAV_AREA, data: { codicon: "account", label: manifest.name, path: EXPERIENCE_ROUTE } }
    ]);
  }
};
export default plugin;
