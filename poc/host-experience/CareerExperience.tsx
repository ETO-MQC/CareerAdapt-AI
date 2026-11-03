import { useEffect, useState } from 'react';
import { ProductTopbar, ProductButton as Button, ProductInput as Input, ProductSelect as Select, ProductSurface as Surface, ProductTabs as Tabs, ProductBadge as Badge, ProductEmptyState as EmptyState } from '../../src/components/ui/product';
import { displayProfileSchema, faithfulScenarios, type DisplayProfile, type DisplayItem, type FaithfulReadClient } from './profile-read-model';
import css from './experience.css';
import productCss from '../../src/styles/product-components.css';
import productTokens from '../../src/styles/product-tokens.css';
type State = {
    kind: 'loading';
} | {
    kind: 'empty';
} | {
    kind: 'invalid';
} | {
    kind: 'error';
    message: string;
} | {
    kind: 'success';
    profile: DisplayProfile;
};
function ProfileView({ profile }: {
    profile: DisplayProfile;
}) {
    const [category, setCategory] = useState('basics'), [selected, setSelected] = useState('basics'), [query, setQuery] = useState(''), [usage, setUsage] = useState('all');
    const current = profile.categories.find(c => c.id === category)!;
    const items = profile.items.filter(i => i.category === category && (usage === 'archived' ? i.archived : !i.archived) && (usage !== 'used' || i.used) && (usage !== 'unused' || !i.used) && [i.title, i.subtitle, i.body, ...i.sources].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
    const item = items.find(i => i.id === selected) || items[0], count = profile.items.filter(i => !i.archived && i.category !== 'basics' && i.category !== 'summary').length;
    return <>
  <ProductTopbar title="个人资料库" status={`${profile.name} · ${count} 条资料 · 只读示例`}/>
  <Surface className="ca-context" aria-label="当前人物与版本"><div className="ca-person"><span className="ca-avatar" aria-hidden="true">{profile.name.slice(0, 1)}</span><div><div className="ca-person-name"><strong>{profile.name}</strong><span>{profile.version}</span><Badge>当前</Badge></div><p>创建于 {profile.createdAt} · {count} 条资料 · {profile.basics.length} 项基础信息</p><p>{profile.background}</p></div></div><div className="ca-context-actions"><Button disabled>管理人物与版本</Button><Button disabled>导入资料</Button><Button disabled>导出 JSON</Button><small>本阶段尚未接入写入、导入与导出</small></div></Surface>
  <Surface className="ca-category-panel" density="compact"><div className="ca-section-heading"><h2>资料分类</h2><span>{profile.categories.length} 类完整目录 · 分类内查看条目与详情</span></div><Tabs aria-label="资料分类" className="ca-category-tabs" onKeyDown={event => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
        return; event.preventDefault(); const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')); const index = tabs.indexOf(document.activeElement as HTMLButtonElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].click(); tabs[next].focus(); }}>{profile.categories.map(c => <button key={c.id} type="button" role="tab" id={`ca-tab-${c.id}`} aria-selected={category === c.id} aria-controls="ca-profile-panels" tabIndex={category === c.id ? 0 : -1} data-section-type={c.sectionType} onClick={() => { setCategory(c.id); setSelected(''); setUsage('all'); }}>{c.label}<b>{profile.items.filter(i => i.category === c.id).length}</b></button>)}</Tabs></Surface>
  <div id="ca-profile-panels" role="tabpanel" aria-labelledby={`ca-tab-${category}`} className="ca-manager">
   <Surface className="ca-list-panel" aria-label="资料条目"><div className="ca-section-heading"><div><h2>{current.label}</h2><p>按名称、来源或内容筛选。</p></div><Button disabled variant="primary">新增</Button></div><div className="ca-filters"><label>搜索<Input aria-label="搜索资料" placeholder="按名称、来源或内容筛选" value={query} onChange={e => setQuery(e.target.value)}/></label><label>使用状态<Select aria-label="使用状态" value={usage} onChange={e => setUsage(e.target.value)}><option value="all">全部当前条目</option><option value="used">已被使用</option><option value="unused">未被使用</option><option value="archived">已归档</option></Select></label></div><div className="ca-managed-list" aria-label="条目列表">{items.map(i => <button type="button" key={i.id} className="ca-managed-row" aria-pressed={i.id === item?.id} onClick={() => setSelected(i.id)}><div><strong>{i.title}</strong><span>{i.subtitle || '暂无补充说明'}</span>{i.date && <time>{i.date}</time>}<p>{i.body}</p><small>{i.sources[0] || '合成资料投影'}</small></div><Badge>{i.archived ? '已归档' : i.used ? '已使用' : '未使用'}</Badge></button>)}{!items.length && <EmptyState title="当前筛选下没有条目" description="切换分类、清空搜索或调整使用状态。此示例不开放新增。"/>}</div><p className="ca-list-footer">{items.length} 个条目 · {current.label} · 只读</p></Surface>
   <Surface className="ca-detail-panel" aria-label="资料详情"><div className="ca-section-heading"><div><h2>详情</h2><p>查看结构化字段、来源与使用状态。</p></div><div className="ca-detail-actions"><Button disabled>编辑</Button><Button disabled>{item?.archived ? '恢复' : '归档'}</Button></div></div><div className="ca-detail-scroll" tabIndex={0} aria-label="详情内容">{item ? <ItemDetail item={item} label={current.label}/> : <EmptyState title="请选择一个条目" description="切换分类，在左侧列表选择条目。"/>}</div></Surface>
  </div>
 </>;
}
function ItemDetail({ item, label }: {
    item: DisplayItem;
    label: string;
}) { return <><div className="ca-detail-title"><h3>{item.title}</h3><Badge>{label}</Badge><Badge>{item.archived ? '已归档' : '当前资料'}</Badge></div><dl className="ca-fields">{item.fields.map(f => <div key={f.key} className={f.multiline ? 'ca-field-wide' : ''}><dt>{f.label}</dt><dd>{f.values.length > 1 ? <ul>{f.values.map((v, i) => <li key={i}>{v}</li>)}</ul> : f.values[0]}</dd></div>)}</dl><section className="ca-source"><h3>原始内容 / 事实说明</h3><p>{item.body || '暂无说明。'}</p></section><section className="ca-source"><h3>来源证据</h3>{item.sources.length ? item.sources.map((s, i) => <p key={i}>{s}</p>) : <p>项目内置合成资料投影；没有外部来源文件。</p>}</section><dl className="ca-metadata"><div><dt>使用状态</dt><dd>{item.used ? '示例中已有草稿或事实引用' : '示例中未被使用'}</dd></div><div><dt>归档状态</dt><dd>{item.archived ? '已归档（合成）' : '当前条目'}</dd></div><div><dt>更新时间</dt><dd>{item.updatedAt}</dd></div></dl><p className="ca-read-note">合成示例中的事实与关联仅用于展示，未连接正式资料库。</p></>; }
function ReadAdapter({ client }: {
    client: FaithfulReadClient;
}) {
    const [state, setState] = useState<State>({ kind: 'loading' }), [attempt, setAttempt] = useState(0);
    useEffect(() => { let active = true; void client.getProfile().then(value => { if (!active)
        return; if (value === null) {
        setState({ kind: 'empty' });
        return;
    } const parsed = displayProfileSchema.safeParse(value); setState(parsed.success ? { kind: 'success', profile: parsed.data } : { kind: 'invalid' }); }, error => { if (active)
        setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) }); }); return () => { active = false; }; }, [client, attempt]);
    return <><div className="ca-read-toolbar"><Badge>合成示例 · 只读 · 未连接正式资料库</Badge><Button onClick={() => { setState({ kind: 'loading' }); setAttempt(n => n + 1); }}>重新加载合成资料</Button></div>{state.kind === 'success' ? <ProfileView profile={state.profile}/> : <div className="ca-state" role={state.kind === 'error' || state.kind === 'invalid' ? 'alert' : 'status'}><EmptyState title={state.kind === 'loading' ? '正在加载合成资料…' : state.kind === 'empty' ? '暂无合成资料' : state.kind === 'invalid' ? '合成资料响应格式无效' : state.message} description="仅验证隔离的只读展示，不影响 Host 或正式资料。"/></div>}</>;
}
/** One existing Host route, pure display; no additional global navigation. */
export function CareerExperience() { const [scenario, setScenario] = useState('success'); return <main className="ca-experience" aria-label="CareerAdapt Profile read only"><style data-careeradapt-experience="">{productTokens + productCss + css}</style><div className="ca-scenario"><label>验证场景 <Select aria-label="验证场景" value={scenario} onChange={e => setScenario(e.target.value)}><option value="success">成功</option><option value="loading">加载中</option><option value="empty">空资料</option><option value="error">服务错误</option><option value="invalid">无效响应</option></Select></label></div><ReadAdapter key={scenario} client={faithfulScenarios[scenario]}/></main>; }
