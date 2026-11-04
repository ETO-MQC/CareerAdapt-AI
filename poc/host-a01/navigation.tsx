import type {ComponentType, ReactNode} from 'react';
import {House, MessagesSquare, Library, Settings, Sparkles} from 'lucide-react';
import './shell.css';

export type NavigationItem = {id: string; label: string; icon: ComponentType<{className?: string}>; route?: string; action?: 'new-session'; keybindActionId?: string};
type Navigate = (item: NavigationItem) => void;
const NativeActionIcon = () => null;
export function CareerNavigation({ onNavigate, showConversation, pathname, contributedNav = [], nativeNav = [], renderKeybind }: {onNavigate: Navigate; showConversation: boolean; pathname: string; contributedNav?: readonly NavigationItem[]; nativeNav?: readonly NavigationItem[]; renderKeybind?: (item: NavigationItem) => ReactNode}) {
  const navigate = (route: string) => onNavigate({id:route,label:route,route,icon:NativeActionIcon});
  return <section className="ca-host-navigation">
    <div className="ca-host-brand"><strong><Sparkles aria-hidden="true" size={20}/>职适 AI</strong><span>CareerAdapt AI</span></div>
    <nav aria-label="CareerAdapt 主导航">
      {[{label:'首页',route:'/careeradapt-home',icon:House},{label:'AI 工作台',route:'/',icon:MessagesSquare},{label:'个人资料库',route:'/careeradapt-experience',icon:Library},{label:'设置',route:'/settings',icon:Settings}].map(({label,route,icon:Icon})=><button key={route} aria-current={pathname===route?'page':undefined} onClick={()=>navigate(route)}><Icon aria-hidden="true" size={17}/><span>{label}</span></button>)}
    </nav>
    <small>Host 集成预览 · 隔离数据</small>
    {contributedNav.length > 0 && <details className="ca-host-extensions"><summary>插件扩展</summary><nav aria-label="插件扩展">
      {contributedNav.map(item=><button key={item.id} aria-label={item.label} aria-current={pathname===item.route?'page':undefined} onClick={()=>onNavigate(item)}><item.icon className="ca-host-nav-icon"/><span>{item.label}</span>{renderKeybind?.(item)}</button>)}
    </nav></details>}
    <details><summary>AI 能力与高级管理</summary><nav aria-label="AI 能力与高级管理">
      {[['能力 / Skills','/skills'],['会话与运行诊断','/command-center'],['产物','/artifacts'],['消息渠道','/messaging'],['Agents','/agents'],['Provider 配置','/profiles'],['定时任务','/cron'],['Webhooks','/webhooks'],['能力图谱','/starmap']].filter(([,route])=>!nativeNav.some(item=>item.route===route)).map(([label,route])=><button key={route} onClick={()=>navigate(route)}>{label}</button>)}
    </nav></details>
    {nativeNav.length > 0 && <details><summary>原生导航与快捷键</summary><nav aria-label="原生导航与快捷键">{nativeNav.map(item=><button key={item.id} aria-label={item.label} aria-current={pathname===item.route?'page':undefined} onClick={()=>onNavigate(item)}><item.icon className="ca-host-nav-icon"/><span>{item.label}</span>{renderKeybind?.(item)}</button>)}</nav></details>}
    {showConversation && <div className="ca-host-conversation-heading"><strong>对话上下文</strong><button onClick={()=>onNavigate({id:'new-session',label:'新建对话',action:'new-session',icon:NativeActionIcon})}>＋ 新建对话</button></div>}
  </section>;
}

export function CareerHome({onNavigate}: {onNavigate: Navigate}) {
  const navigate=(route: string)=>onNavigate({id:route,label:route,route,icon:NativeActionIcon});
  return <main className="ca-host-home" aria-label="CareerAdapt 首页"><span>CAREERADAPT AI / HOST INTEGRATION PREVIEW</span><h1>从你的经历，走向下一步。</h1><p>在 AI 工作台使用 Hermes 原生对话，或查看个人资料库的只读合成示例。</p><div className="ca-host-home-actions"><button onClick={()=>navigate('/')}>打开 AI 工作台</button><button onClick={()=>navigate('/careeradapt-experience')}>查看个人资料库</button></div><section><h2>本次连接范围</h2><p>对话、附件入口、会话上下文沿用 Hermes 原生组件。资料库沿用已验收的 Slice 1 展示层，未连接正式资料。</p><h2>原有业务页面</h2><p>岗位中心、求职申请、简历工作室和资料导入保留在原 CareerAdapt 应用，本次尚未迁移。没有在此创建替代业务页。</p><p>模型执行依赖有效 Provider；此隔离环境未配置真实凭据。</p></section></main>;
}
