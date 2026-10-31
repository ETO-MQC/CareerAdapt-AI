import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, type HermesPlugin } from "@hermes/plugin-sdk";
import { demoCareerProfile } from "../../src/data/demoProfile";
import { createCareerDomainReadClient } from "./read-client";
import { ProfileCareerView } from "./ProfileCareerView";

const client = createCareerDomainReadClient(demoCareerProfile);
export const ProfileHostAdapter = { navigate: host.navigate, notify: host.notify };
export const PROFILE_ROUTE = "/career-profile";

const plugin: HermesPlugin = {
  id: "careeradapt-profile-poc",
  name: "Career Profile (read-only PoC)",
  register(ctx) {
    ctx.registerMany([
      { id: "profile-page", area: ROUTES_AREA, title: "Career Profile", data: { path: PROFILE_ROUTE }, render: () => <ProfileCareerView profile={client.readCurrentProfile()} /> },
      { id: "profile-nav", area: SIDEBAR_NAV_AREA, data: { codicon: "account", label: "Career Profile", path: PROFILE_ROUTE } }
    ]);
  }
};
export default plugin;
