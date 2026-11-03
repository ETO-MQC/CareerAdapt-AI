import { useRef, useState } from "react";
import { ProductButton as Button, ProductBadge as Status, ProductInput as Input, ProductSelect as Select, ProductEmptyState as EmptyState } from "../../src/components/ui/product";
import { ProfileHostAdapter } from "../profile-packaging/ProfileHostAdapter";
import { fakeProfileReadClient, type ProfileReadClient } from "../profile-packaging/client";
import css from "./experience.css";
import { CareerCard, CareerSpecDialog, CareerTabs, CareerTextarea } from "./components";

const pages = ["Profile", "Jobs", "Applications", "Resume Studio"];
const categories = ["基础资料", "教育经历", "工作经历", "项目经历", "奖项", "技能", "语言"];
const scenarios: Record<string, ProfileReadClient> = {
  success: fakeProfileReadClient,
  empty: { getProfile: async () => null },
  error: { getProfile: async () => { throw new Error("合成资料服务暂不可用，请重试。"); } },
  invalid: { getProfile: async () => ({ invalid: true }) },
  loading: { getProfile: () => new Promise(() => {}) }
};

/** Synthetic-only route. No Host theme setter, business persistence or provider. */
export function CareerExperience() {
  const [page, setPage] = useState("Profile");
  const [scenario, setScenario] = useState("success");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("基础资料");
  const [specTab, setSpecTab] = useState("控件");
  const root = useRef<HTMLDivElement>(null);
  function selectCategory(label: string) {
    setCategory(label);
    const section = Array.from(root.current?.querySelectorAll<HTMLElement>(".ca-profile-poc section") ?? []).find(el => el.getAttribute("aria-label") === label);
    section?.scrollIntoView({ block: "start" });
  }
  return <div ref={root} className="ca-experience" aria-label="CareerAdapt Experience">
    <style data-careeradapt-experience="">{css}</style>
    <aside className="ca-career-nav">
      <div className="ca-brand"><strong>职适 AI</strong><span>CareerAdapt</span></div>
      <nav aria-label="职业工作区">{pages.map(item => <Button key={item} aria-current={page === item ? "page" : undefined} onClick={() => setPage(item)}>{item}</Button>)}</nav>
      <p className="ca-nav-note">合成资料 · 只读展示<br />Host 集成验证</p>
    </aside>
    <div className="ca-main">
      <header className="ca-page-header"><div><span className="ca-eyebrow">CAREER WORKSPACE</span><h1>{page === "Profile" ? "个人资料库" : page}</h1></div><Status>合成数据 / 未接入正式业务</Status><CareerSpecDialog><CareerTabs labels={["控件", "状态"]} value={specTab} onChange={setSpecTab} /><div role="tabpanel" aria-label={specTab}>{specTab === "控件" ? <CareerCard title="局部语义控件"><label>只读输入<Input readOnly value="仅合成展示" /></label><label>只读多行<CareerTextarea readOnly value="不写入 Profile、简历或 Host 设置。" /></label><Button disabled>未开放正式写入</Button></CareerCard> : <CareerCard title="状态规范"><Status>合成数据</Status><p role="status">加载、空资料、错误与无效响应可通过验证场景逐一查看。</p></CareerCard>}</div></CareerSpecDialog></header>
      <div className="ca-page-body" hidden={page !== "Profile"}>
        <div className="ca-profile-toolbar"><p>集中查看职业经历与技能，正式数据接入尚未开放。</p><label>验证场景 <Select value={scenario} onChange={e => setScenario(e.target.value)}><option value="success">成功</option><option value="loading">加载中</option><option value="empty">空资料</option><option value="error">服务错误</option><option value="invalid">无效响应</option></Select></label></div>
        <div className="ca-profile-workspace">
          <aside className="ca-categories" aria-label="资料分类"><label htmlFor="ca-category-search">查找分类</label><Input id="ca-category-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入分类名称" />
            <nav aria-label="资料板块">{categories.filter(label => label.includes(query.trim())).map(label => <Button key={label} aria-current={category === label ? "true" : undefined} onClick={() => selectCategory(label)}>{label}</Button>)}</nav>
            {categories.every(label => !label.includes(query.trim())) && <p role="status">没有匹配的分类</p>}
          </aside>
          <div className="ca-profile-content" tabIndex={0} aria-label="合成资料内容"><ProfileHostAdapter key={scenario} client={scenarios[scenario]} /></div>
        </div>
      </div>
      {page !== "Profile" && <div className="ca-placeholder"><EmptyState title={`${page} 尚未接入`} description="本轮仅验证合成 Profile 展示；此入口保留信息架构，不提供正式业务操作。" actions={<Button onClick={() => setPage("Profile")}>返回个人资料库</Button>} /></div>}
    </div>
  </div>;
}
