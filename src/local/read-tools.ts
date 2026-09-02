import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { LOCAL_LIMITS } from './limits.js';
import { SnapshotIdSchema } from './domain.js';
import { LocalWorkspaceService } from './workspace-service.js';

const Bound = { taskId: TaskIdSchema, snapshotId: SnapshotIdSchema };
const BoundSchema = z.object(Bound).strict();
const PathSchema = z.string().min(1);
const ChunkSchema = z
  .object({
    ...Bound,
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().optional(),
  })
  .strict();

export const LOCAL_READ_TOOL_NAMES = [
  'workspace_info',
  'list_directory',
  'read_file',
  'search_workspace',
  'git_status',
  'git_diff',
  'test_status',
  'execution_summary',
] as const;
export type LocalReadToolName = (typeof LOCAL_READ_TOOL_NAMES)[number];

export function createLocalReadTools(service: LocalWorkspaceService) {
  return {
    workspace_info: tool(BoundSchema, (input) => service.workspaceInfo(input)),
    list_directory: tool(
      z
        .object({
          ...Bound,
          path: PathSchema.optional(),
          cursor: z.string().optional(),
          limit: z.number().int().positive().max(LOCAL_LIMITS.directoryPageEntries).optional(),
        })
        .strict(),
      (input) => service.listDirectory(input),
    ),
    read_file: tool(
      z
        .object({
          ...Bound,
          path: PathSchema,
          offset: z.number().int().nonnegative().optional(),
          length: z.number().int().positive().optional(),
        })
        .strict(),
      (input) => service.readFile(input),
    ),
    search_workspace: tool(
      z
        .object({
          ...Bound,
          query: z.string().min(1).max(1024),
          path: PathSchema.optional(),
          limit: z.number().int().positive().max(LOCAL_LIMITS.searchResults).optional(),
        })
        .strict(),
      (input) => service.searchWorkspace(input),
    ),
    git_status: tool(ChunkSchema, (input) => service.gitStatus(input)),
    git_diff: tool(ChunkSchema, (input) => service.gitDiff(input)),
    test_status: tool(BoundSchema, (input) => service.testStatus(input)),
    execution_summary: tool(BoundSchema, (input) => service.executionSummary(input)),
  } satisfies Record<LocalReadToolName, LocalReadToolDefinition<any>>;
}

export interface LocalReadToolDefinition<T> {
  readonly inputSchema: z.ZodType<T>;
  invoke(input: unknown): Promise<unknown>;
}

function tool<T>(
  inputSchema: z.ZodType<T>,
  handler: (input: T) => Promise<unknown>,
): LocalReadToolDefinition<T> {
  return { inputSchema, invoke: async (input) => handler(inputSchema.parse(input)) };
}
