import { ROUTES_AREA, SIDEBAR_NAV_AREA, type HermesPlugin } from "@hermes/plugin-sdk";
import { ProfileHostAdapter } from "./ProfileHostAdapter";

// Locked disk-loader manifest IS this default ESM object, not dashboard JSON.
export const manifest = { id: "careeradapt-profile-packaging-poc", name: "CareerAdapt Profile", defaultEnabled: true };
export const PROFILE_ROUTE = "/careeradapt-profile";
const plugin: HermesPlugin = {
  ...manifest,
  register(ctx) {
    ctx.registerMany([
      { id: "profile-page", area: ROUTES_AREA, title: manifest.name, data: { path: PROFILE_ROUTE }, render: () => <ProfileHostAdapter /> },
      { id: "profile-nav", area: SIDEBAR_NAV_AREA, data: { codicon: "account", label: manifest.name, path: PROFILE_ROUTE } }
    ]);
  }
};
export default plugin;
