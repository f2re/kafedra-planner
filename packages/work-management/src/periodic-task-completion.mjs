import { getPeriodicTaskV2, updatePeriodicTaskV2 } from './periodic-tasks.mjs';

const ACTIONS = new Set(['complete', 'reopen']);

export function transitionPeriodicTaskV2(database, workspaceId, taskId, action, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  if (!ACTIONS.has(action)) throw new Error('periodic_task_transition_invalid');
  const current = getPeriodicTaskV2(database, workspaceId, taskId);
  if (!current) return null;
  if (current.status === 'cancelled') throw new Error('periodic_task_transition_cancelled');

  const target = action === 'complete' ? 'completed' : 'open';
  if (action === 'reopen' && current.status !== 'completed') {
    throw new Error('periodic_task_transition_invalid_state');
  }
  if (action === 'complete' && current.status === 'completed') return current;

  return updatePeriodicTaskV2(database, workspaceId, taskId, {
    status: target,
    reason: action === 'complete' ? 'Выполнено' : 'Вернуто в работу'
  }, { actorPersonId, now });
}
