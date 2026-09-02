import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import {
  DuetRunCheckpointSchema,
  DuetRunCheckpointV2Schema,
  type DuetRunCheckpoint,
  type DuetRunCheckpointV1,
  type DuetRunCheckpointV2,
} from './run.js';

type IterationArtifactName =
  | 'plan.md'
  | 'review-envelope.txt'
  | 'planner-control.txt'
  | 'planner-control.json'
  | 'reviewer-control.txt'
  | 'reviewer-control.json';

export class DuetRunStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<DuetRunCheckpoint | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      return DuetRunCheckpointSchema.parse(
        JSON.parse(await readFile(this.checkpointPath(taskId), 'utf8')),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: DuetRunCheckpoint): Promise<void> {
    const checkpoint = DuetRunCheckpointSchema.parse(value);
    await this.atomicWrite(
      this.checkpointPath(checkpoint.taskId),
      JSON.stringify(checkpoint, null, 2),
    );
  }

  async writeRequestArtifact(taskIdInput: string, content: string): Promise<void> {
    const taskId = this.taskId(taskIdInput);
    await this.atomicWrite(path.join(this.runDirectory(taskId), 'request.md'), content);
  }

  async writeIterationArtifact(
    taskIdInput: string,
    iteration: number,
    name: IterationArtifactName,
    content: string,
  ): Promise<void> {
    if (!Number.isInteger(iteration) || iteration < 1)
      throw new ChatbridgeError('Invalid iteration artifact path', 'INVALID_ITERATION');
    const taskId = this.taskId(taskIdInput);
    await this.atomicWrite(this.iterationArtifactPath(taskId, iteration, name), content);
  }

  requestArtifactPath(taskIdInput: string): string {
    return path.join(this.runDirectory(this.taskId(taskIdInput)), 'request.md');
  }

  iterationArtifactPath(
    taskIdInput: string,
    iteration: number,
    name: IterationArtifactName,
  ): string {
    if (!Number.isInteger(iteration) || iteration < 1)
      throw new ChatbridgeError('Invalid iteration artifact path', 'INVALID_ITERATION');
    return path.join(
      this.runDirectory(this.taskId(taskIdInput)),
      'iterations',
      String(iteration),
      name,
    );
  }

  legacyArtifactPath(taskIdInput: string, name: 'plan.md' | 'review-envelope.txt'): string {
    return path.join(this.runDirectory(this.taskId(taskIdInput)), name);
  }

  async migrate(taskIdInput: string): Promise<DuetRunCheckpointV2> {
    const taskId = this.taskId(taskIdInput);
    const existing = await this.read(taskId);
    if (!existing) throw new ChatbridgeError(`Run not found for ${taskId}`, 'RUN_NOT_FOUND');
    if (existing.version === 2) return existing;

    const migrated = migrateV1(existing);
    if (existing.plan)
      await this.copyLegacyArtifact(
        this.legacyArtifactPath(taskId, 'plan.md'),
        this.iterationArtifactPath(taskId, existing.iteration, 'plan.md'),
      );
    if (existing.reviewTarget)
      await this.copyLegacyArtifact(
        this.legacyArtifactPath(taskId, 'review-envelope.txt'),
        this.iterationArtifactPath(
          taskId,
          existing.state === 'PLAN' && existing.iteration > 1
            ? existing.iteration - 1
            : existing.iteration,
          'review-envelope.txt',
        ),
      );
    await this.write(migrated);
    return migrated;
  }

  private checkpointPath(taskId: string): string {
    return path.join(this.stateRoot, 'runs', `${taskId}.json`);
  }

  private runDirectory(taskId: string): string {
    return path.join(this.stateRoot, 'runs', taskId);
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for run path', 'INVALID_TASK_ID');
    return parsed.data;
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  }

  private async copyLegacyArtifact(source: string, destination: string): Promise<void> {
    try {
      await this.atomicWrite(destination, await readFile(source, 'utf8'));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function migrateV1(value: DuetRunCheckpointV1): DuetRunCheckpointV2 {
  const iterations = value.plan
    ? Array.from({ length: value.iteration }, (_, index) => {
        const iteration = index + 1;
        const isCurrent = iteration === value.iteration;
        const ownsLegacyReview = value.reviewTarget
          ? value.state === 'PLAN' && value.iteration > 1
            ? iteration === value.iteration - 1
            : isCurrent
          : false;
        return {
          iteration,
          plan: isCurrent ? value.plan! : { legacyEvidenceUnavailable: true as const },
          ...(ownsLegacyReview ? { reviewTarget: value.reviewTarget } : {}),
        };
      })
    : [];
  return DuetRunCheckpointV2Schema.parse({
    version: 2,
    taskId: value.taskId,
    mode: value.mode,
    iteration: value.iteration,
    state: value.state,
    context: value.context,
    request: value.request,
    iterations,
    limits: { maxIterations: 8 },
    ...(value.blockedPhase ? { blockedPhase: value.blockedPhase } : {}),
    createdAt: value.createdAt,
    updatedAt: new Date().toISOString(),
  });
}
