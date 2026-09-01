import type { TaskState } from './protocol.js';
import { ProtocolError } from './errors.js';
const transitions: Record<TaskState, readonly TaskState[]> = {
  INIT: ['PLANNING', 'CANCELLED', 'FAILED'],
  PLANNING: ['PLAN', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PLAN: ['EXECUTING', 'BLOCKED', 'CANCELLED'],
  EXECUTING: ['EXECUTED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  EXECUTED: ['REVIEWING', 'FAILED', 'CANCELLED'],
  REVIEWING: ['PLAN', 'DONE', 'BLOCKED', 'FAILED', 'CANCELLED'],
  DONE: [],
  BLOCKED: ['PLANNING', 'EXECUTING', 'REVIEWING', 'CANCELLED'],
  FAILED: [],
  CANCELLED: [],
};
export function canTransition(from: TaskState, to: TaskState) {
  return transitions[from].includes(to);
}
export function assertTransition(from: TaskState, to: TaskState) {
  if (!canTransition(from, to))
    throw new ProtocolError(`Illegal state transition: ${from} -> ${to}`);
}
