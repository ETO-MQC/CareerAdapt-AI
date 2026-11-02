import { useEffect, useState } from "react";
import { ProfileCareerView } from "../profile-plugin/ProfileCareerView";
import type { ProfileSnapshot } from "../profile-plugin/read-client";
import { fakeProfileReadClient, InvalidProfileResponse, parseProfile, type ProfileReadClient } from "./client";

type State = { kind: "loading" } | { kind: "empty" } | { kind: "invalid" } | { kind: "error"; message: string } | { kind: "success"; profile: ProfileSnapshot };

export function ProfileHostAdapter({ client = fakeProfileReadClient }: { client?: ProfileReadClient }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const profile = parseProfile(await client.getProfile());
        if (active) setState(profile === null ? { kind: "empty" } : { kind: "success", profile });
      } catch (error) {
        if (active) setState(error instanceof InvalidProfileResponse ? { kind: "invalid" } : { kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
    void load();
    return () => { active = false; };
  }, [client, attempt]);
  return <div aria-label="CareerAdapt Profile Plugin">
    <button type="button" onClick={() => { setState({ kind: "loading" }); setAttempt(n => n + 1); }}>重新加载合成资料</button>
    {state.kind === "success" ? <ProfileCareerView profile={state.profile} />
      : <p role={state.kind === "error" || state.kind === "invalid" ? "alert" : "status"}>
        {state.kind === "loading" ? "正在加载合成资料…" : state.kind === "empty" ? "暂无合成资料" : state.kind === "invalid" ? "合成资料响应格式无效" : state.message}
      </p>}
  </div>;
}
