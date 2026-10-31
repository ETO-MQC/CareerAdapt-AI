import type { ProfileSnapshot } from "./read-client";
import css from "./profile.css";

/** Host-neutral presentation of the existing canonical Profile projection. */
export function ProfileCareerView({ profile }: { profile: ProfileSnapshot }) {
  return <article className="ca-profile-poc" aria-label="CareerAdapt Profile read only">
    <style data-careeradapt-profile-poc="">{css}</style>
    <header><p>CAREERADAPT · PROFILE</p><h1>{profile.name}</h1><span>只读概念验证 · 示例资料</span></header>
    <section aria-label="基础资料"><h2>基础资料</h2><dl>{profile.basics.map(([key, value]) => <div key={key}><dt>{({ name: "姓名", email: "邮箱", phone: "电话", location: "所在地", headline: "个人简介" } as Record<string, string>)[key] ?? key}</dt><dd>{value}</dd></div>)}</dl></section>
    {profile.sections.map(section => <section key={section.id} aria-label={section.label}><h2>{section.label}</h2>{section.items.map(item => <div className="ca-profile-item" key={item.id}><h3>{item.title}</h3>{item.subtitle && <p>{item.subtitle}</p>}<p className="ca-profile-body">{item.body}</p></div>)}</section>)}
    {profile.sections.length === 0 && <p>暂无已确认资料</p>}
  </article>;
}
