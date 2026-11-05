import { expect, it } from 'vitest';
import { prepareCareerWorkflowInvocation } from '@/agent/workflows/CareerWorkflowFacade';

const jd = `岗位职责：负责数据分析、实验设计与交付。任职要求：Python 或 R 任一即可。${'补充岗位说明。'.repeat(40)}`;

it('recovers current-turn JD with legal mode and persistence options', () => {
  const prepared = prepareCareerWorkflowInvocation('career.workflow.tailor_resume', {
    sourceResumeId: 'synthetic-resume', mode: 'competitive', jobPersistence: 'session_only'
  }, { logicalTurnId: 'synthetic-turn', sourceUserMessageId: 'synthetic-message', sourceUserMessage: jd }, 'synthetic-operation');
  expect(prepared.input).toMatchObject({ targetText: jd, mode: 'competitive', jobPersistence: 'session_only' });
  expect(prepared.sameTurnTarget).toBe(true);
});

it('does not replace an explicit saved Job with text or inherit a historical Job', () => {
  const explicit = prepareCareerWorkflowInvocation('career.workflow.tailor_resume', { jobId: 'chosen-job' }, { sourceUserMessage: jd }, 'op');
  expect(explicit.input).toEqual({ jobId: 'chosen-job' });
  expect(() => prepareCareerWorkflowInvocation('career.workflow.tailor_resume', { mode: 'competitive' }, {
    sourceUserMessage: '帮我优化简历'
  }, 'op')).toThrow(expect.objectContaining({ code: 'target_required' }));
});

it('preserves checkpoint continuation and rejects malformed options', () => {
  expect(prepareCareerWorkflowInvocation('career.workflow.tailor_resume', { checkpointId: 'checkpoint', userAnswer: '没有用过 Kubernetes' }, { sourceUserMessage: jd }, 'op').input)
    .toEqual({ checkpointId: 'checkpoint', userAnswer: '没有用过 Kubernetes' });
  expect(() => prepareCareerWorkflowInvocation('career.workflow.tailor_resume', { mode: 'invalid' }, { sourceUserMessage: jd }, 'op')).toThrow();
});
