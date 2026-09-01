import { z } from 'zod';

export const TaskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid task ID');
export type TaskId = z.infer<typeof TaskIdSchema>;

export const TestStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_RUN']);
export type TestStatus = z.infer<typeof TestStatusSchema>;
