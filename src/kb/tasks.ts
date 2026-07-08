import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Vault } from '../vault.js';
import { slugify } from './ingest.js';

/**
 * Structured task queue: one markdown file per task under tasks/{agent,human},
 * archived to tasks/{done,failed} on completion. Agents poll the queue, claim
 * a task atomically, read its context_files, do the work, and mark it done —
 * no human briefing needed.
 *
 * Claim atomicity: an O_EXCL lock file under tasks/.locks/ guarantees that of
 * two concurrent claimers exactly one wins, even across processes (the MCP
 * gateway spawns one server per session).
 */

export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'failed' | 'cancelled';
export type TaskQueue = 'agent' | 'human';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface TaskRecord {
  taskId: string;
  title: string;
  status: TaskStatus;
  queue: TaskQueue;
  assignedTo?: string;
  agentType?: string;
  priority: TaskPriority;
  product?: string;
  created: string;
  claimedAt?: string;
  completedAt?: string;
  contextFiles: string[];
  path: string;          // vault-relative path of the task file
  body: string;
}

export interface CreateTaskInput {
  title: string;
  queue: TaskQueue;
  description: string;
  priority?: TaskPriority;
  product?: string;
  agentType?: string;
  assignedTo?: string;
  contextFiles?: string[];
  acceptanceCriteria?: string[];
}

const TASKS_ROOT = 'tasks';
const ACTIVE_DIRS: TaskQueue[] = ['agent', 'human'];
const ARCHIVE_DIRS = ['done', 'failed'] as const;

function tasksDir(vault: Vault, sub: string): string {
  return join(vault.path, TASKS_ROOT, sub);
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseTaskFile(vault: Vault, relPath: string, queue: TaskQueue): TaskRecord | null {
  let raw: string;
  try { raw = vault.readFileRaw(relPath); } catch { return null; }
  const { data, content } = matter(raw);
  if (typeof data.task_id !== 'string' || !data.task_id) return null;
  const status = String(data.status ?? 'pending') as TaskStatus;
  return {
    taskId: data.task_id,
    title: typeof data.title === 'string' ? data.title : data.task_id,
    status,
    queue,
    assignedTo: typeof data.assigned_to === 'string' && data.assigned_to ? data.assigned_to : undefined,
    agentType: typeof data.agent_type === 'string' && data.agent_type ? data.agent_type : undefined,
    priority: (['critical', 'high', 'medium', 'low'].includes(String(data.priority)) ? String(data.priority) : 'medium') as TaskPriority,
    product: typeof data.product === 'string' && data.product ? data.product : undefined,
    created: String(data.created ?? ''),
    claimedAt: data.claimed_at ? String(data.claimed_at) : undefined,
    completedAt: data.completed_at ? String(data.completed_at) : undefined,
    contextFiles: Array.isArray(data.context_files) ? data.context_files.map(String) : [],
    path: relPath,
    body: content.trim(),
  };
}

async function listTaskFiles(vault: Vault, sub: string): Promise<string[]> {
  const dir = tasksDir(vault, sub);
  if (!existsSync(dir)) return [];
  return vault.listFiles(`${TASKS_ROOT}/${sub}/*.md`);
}

export interface ListTasksFilter {
  status?: TaskStatus;
  queue?: TaskQueue;
  includeArchived?: boolean;
}

export async function listTasks(vault: Vault, filter: ListTasksFilter = {}): Promise<TaskRecord[]> {
  const tasks: TaskRecord[] = [];
  const queues = filter.queue ? [filter.queue] : ACTIVE_DIRS;
  for (const q of queues) {
    for (const f of await listTaskFiles(vault, q)) {
      const t = parseTaskFile(vault, f, q);
      if (t) tasks.push(t);
    }
  }
  if (filter.includeArchived) {
    for (const sub of ARCHIVE_DIRS) {
      for (const f of await listTaskFiles(vault, sub)) {
        // archived tasks keep their original queue in frontmatter-less form;
        // report them under 'agent' unless the id says otherwise — queue is
        // informational once archived.
        const t = parseTaskFile(vault, f, 'agent');
        if (t) tasks.push(t);
      }
    }
  }
  const filtered = filter.status ? tasks.filter(t => t.status === filter.status) : tasks;
  const prioRank: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return filtered.sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || a.created.localeCompare(b.created));
}

export function createTask(vault: Vault, input: CreateTaskInput): TaskRecord {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const taskId = `${stamp}-${slugify(input.title, 40)}`;
  const relPath = `${TASKS_ROOT}/${input.queue}/${taskId}.md`;

  mkdirSync(tasksDir(vault, input.queue), { recursive: true });
  if (vault.fileExists(relPath)) {
    throw new Error(`Task file already exists: ${relPath}`);
  }

  const frontmatter: Record<string, unknown> = {
    task_id: taskId,
    title: input.title,
    status: 'pending',
    assigned_to: input.assignedTo ?? (input.queue === 'agent' ? 'agent' : ''),
    agent_type: input.agentType ?? '',
    priority: input.priority ?? 'medium',
    product: input.product ?? '',
    created: now.toISOString().slice(0, 10),
    claimed_at: '',
    completed_at: '',
    context_files: input.contextFiles ?? [],
  };

  const sections = [`## Task\n${input.description.trim()}`];
  if (input.acceptanceCriteria?.length) {
    sections.push(`## Acceptance Criteria\n${input.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')}`);
  }
  sections.push('## Notes\n');

  vault.writeFile(relPath, matter.stringify(sections.join('\n\n') + '\n', frontmatter));
  return parseTaskFile(vault, relPath, input.queue)!;
}

async function findActiveTask(vault: Vault, taskId: string): Promise<TaskRecord | null> {
  for (const q of ACTIVE_DIRS) {
    const direct = `${TASKS_ROOT}/${q}/${taskId}.md`;
    if (vault.fileExists(direct)) {
      const t = parseTaskFile(vault, direct, q);
      if (t) return t;
    }
    for (const f of await listTaskFiles(vault, q)) {
      const t = parseTaskFile(vault, f, q);
      if (t?.taskId === taskId) return t;
    }
  }
  return null;
}

function rewriteFrontmatter(vault: Vault, relPath: string, updates: Record<string, unknown>): void {
  const raw = vault.readFileRaw(relPath);
  const { data, content } = matter(raw);
  vault.writeFile(relPath, matter.stringify(content, { ...data, ...updates }));
}

/**
 * Atomically claim a pending task. Returns the updated record.
 * Throws if the task is missing, not pending, or currently locked by
 * another claimer.
 */
export async function claimTask(vault: Vault, taskId: string, agentId: string): Promise<TaskRecord> {
  const locksDir = tasksDir(vault, '.locks');
  mkdirSync(locksDir, { recursive: true });
  const lockPath = join(locksDir, `${taskId}.lock`);

  try {
    // O_EXCL: fails if the lock already exists — the atomic gate.
    writeFileSync(lockPath, agentId, { flag: 'wx' });
  } catch {
    throw new Error(`Task ${taskId} is being claimed by another agent — try again or pick a different task.`);
  }

  try {
    const task = await findActiveTask(vault, taskId);
    if (!task) throw new Error(`Task not found in active queues: ${taskId}`);
    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is not pending (status: ${task.status}${task.assignedTo ? `, assigned to ${task.assignedTo}` : ''}).`);
    }
    rewriteFrontmatter(vault, task.path, {
      status: 'in-progress',
      assigned_to: agentId,
      claimed_at: nowIso(),
    });
    return (await findActiveTask(vault, taskId))!;
  } finally {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/**
 * Mark an in-progress (or pending) task done/failed and archive it to
 * tasks/done/ or tasks/failed/. Notes are appended to the ## Notes section.
 */
export async function completeTask(
  vault: Vault,
  taskId: string,
  outcome: 'done' | 'failed',
  notes?: string,
): Promise<TaskRecord> {
  const task = await findActiveTask(vault, taskId);
  if (!task) throw new Error(`Task not found in active queues: ${taskId}`);
  if (task.status === 'done' || task.status === 'failed') {
    throw new Error(`Task ${taskId} is already ${task.status}.`);
  }

  const raw = vault.readFileRaw(task.path);
  const { data, content } = matter(raw);
  const updated = {
    ...data,
    status: outcome,
    completed_at: nowIso(),
  };
  let body = content;
  if (notes?.trim()) {
    body = body.trimEnd() + `\n\n### ${outcome === 'done' ? 'Completion' : 'Failure'} notes (${nowIso()})\n${notes.trim()}\n`;
  }

  const archiveRel = `${TASKS_ROOT}/${outcome}/${task.path.split('/').pop()}`;
  vault.writeFile(task.path, matter.stringify(body, updated));
  vault.moveFile(task.path, archiveRel);

  const done = parseTaskFile(vault, archiveRel, task.queue);
  if (!done) throw new Error(`Archived task unreadable: ${archiveRel}`);
  return done;
}
