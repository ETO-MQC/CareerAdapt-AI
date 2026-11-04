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
