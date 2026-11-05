import { expect, it } from 'vitest';
import { classifyTurnIntent } from '@/agent/runtime/AgentTurnIntent';
import { AgentTaskStateSchema } from '@/agent/contracts/agentSession';

const taskState = AgentTaskStateSchema.parse({ rootGoal: 'conversation', workflowId: 'conversation', stage: 'collecting_intent', updatedAt: '2026-11-05T00:00:00.000Z' });
it.each(['帮我整理资料库。我在课程项目中用 Excel 合并三份数据，完成清洗并提交核对报告。', '完善我的个人资料库：我有一段数据清洗项目经历。'])('binds an explicit existing-library intake to the formal workflow: %s', text => {
  expect(classifyTurnIntent({ text, taskState }).newTask).toMatchObject({ goal: 'profile_intake', workflowId: 'guided_profile_intake' });
});
it('keeps a library read distinct from an intake request', () => {
  expect(classifyTurnIntent({ text: '查看我的资料库有什么', taskState }).newTask?.goal).not.toBe('profile_intake');
});
it('does not turn a prohibition on Profile synchronization into an intake request', () => {
  expect(classifyTurnIntent({ text: '帮我改简历，不要更新我的个人资料库', taskState }).newTask?.goal).not.toBe('profile_intake');
});
