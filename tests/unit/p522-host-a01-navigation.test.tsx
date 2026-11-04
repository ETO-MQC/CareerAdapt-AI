import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {CareerNavigation, CareerHome} from '../../poc/host-a01/navigation';

describe('CareerAdapt Host navigation delegates to native actions',()=>{
 it('routes Profile without clearing or creating a session',()=>{
  const onNavigate=vi.fn();
  render(<CareerNavigation pathname="/careeradapt-experience" showConversation={false} onNavigate={onNavigate}/>);
  const nav=screen.getByRole('navigation',{name:'CareerAdapt 主导航'});
  expect(within(nav).getAllByRole('button')).toHaveLength(4);
  expect(screen.queryByText('对话上下文')).toBeNull();
  fireEvent.click(within(nav).getByRole('button',{name:'个人资料库'}));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({route:'/careeradapt-experience',id:'/careeradapt-experience'}));
  expect(onNavigate.mock.calls[0][0].action).toBeUndefined();
 });
 it('delegates fresh conversation to the native new-session action',()=>{
  const onNavigate=vi.fn();
  render(<CareerNavigation pathname="/" showConversation onNavigate={onNavigate}/>);
  fireEvent.click(screen.getByRole('button',{name:/新建对话/}));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'new-session',action:'new-session'}));
  expect(onNavigate.mock.calls[0][0].route).toBeUndefined();
 });
 it('keeps native advanced routes reachable and excludes unmigrated business routes',()=>{
  const onNavigate=vi.fn();
  render(<CareerNavigation pathname="/" showConversation onNavigate={onNavigate}/>);
  fireEvent.click(screen.getByText('AI 能力与高级管理'));
  const advanced=screen.getByRole('navigation',{name:'AI 能力与高级管理'});
  fireEvent.click(within(advanced).getByRole('button',{name:'Provider 配置'}));
  expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({route:'/profiles'}));
  expect(screen.queryByRole('button',{name:'简历工作室'})).toBeNull();
 });
 it('home links use the same native route action',()=>{
  const onNavigate=vi.fn();render(<CareerHome onNavigate={onNavigate}/>);
  fireEvent.click(screen.getByRole('button',{name:'打开 AI 工作台'}));
  expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({route:'/'}));
 });
});


describe('Host plugin navigation compatibility',()=>{
 const Icon=()=> <svg aria-hidden="true"/>;
 it('preserves contributed route object, label and icon outside primary navigation',()=>{
  const onNavigate=vi.fn(); const item={id:'third-party.board',label:'Third-party board',route:'/third-party-board',icon:Icon};
  render(<CareerNavigation pathname="/third-party-board" showConversation={false} onNavigate={onNavigate} contributedNav={[item]}/>);
  const extensions=screen.getByRole('navigation',{name:'插件扩展',hidden:true});
  fireEvent.click(screen.getByText('插件扩展'));
  const button=within(extensions).getByRole('button',{name:item.label});
  expect(button.getAttribute('aria-current')).toBe('page');fireEvent.click(button);
  expect(onNavigate.mock.calls[0][0]).toBe(item);
  expect(within(screen.getByRole('navigation',{name:'CareerAdapt 主导航'})).getAllByRole('button')).toHaveLength(4);
 });
 it('preserves native actions, keybind metadata, and conversation context across contribution changes',()=>{
  const onNavigate=vi.fn();const action={id:'new-session',label:'New session',icon:Icon,action:'new-session' as const,keybindActionId:'session.new'};
  const plugin={id:'board',label:'Board',icon:Icon,route:'/board'};
  const props={pathname:'/',showConversation:true,onNavigate,nativeNav:[action],renderKeybind:(item:{keybindActionId?:string})=> <kbd>{item.keybindActionId}</kbd>};
  const {rerender}=render(<CareerNavigation {...props} contributedNav={[plugin]}/>);
  fireEvent.click(screen.getByText('原生导航与快捷键'));fireEvent.click(screen.getByRole('button',{name:'New session'}));
  expect(onNavigate.mock.calls[0][0]).toBe(action);expect(screen.getByText('session.new')).toBeTruthy();
  rerender(<CareerNavigation {...props} contributedNav={[]}/>);expect(screen.queryByText('插件扩展')).toBeNull();expect(screen.getByText('对话上下文')).toBeTruthy();
  rerender(<CareerNavigation {...props} pathname="/board" showConversation={false} contributedNav={[plugin]}/>);
  expect(screen.queryByText('对话上下文')).toBeNull();fireEvent.click(screen.getByText('插件扩展'));
  expect(screen.getByRole('button',{name:'Board'}).getAttribute('aria-current')).toBe('page');
 });
});
