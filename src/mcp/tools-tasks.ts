import { z } from 'zod';
import type { ZodRawShape } from 'zod';
import { defineTool, type ToolDef } from './registry.js';
import { listTasks, createTask, claimTask, completeTask } from '../kb/tasks.js';

/**
 * Structured task queue over MCP: tasks/{agent,human} hold one markdown file
 * per task; agents list → claim (atomic) → work → complete. See
 * src/kb/tasks.ts for the file format.
 */

const tasksList = defineTool({
  name: 'obs_tasks_list',
  description: 'List structured tasks from tasks/agent and tasks/human. Each task is a markdown file with status/priority/context_files frontmatter.',
  scope: 'read',
  schema: {
    status: z.enum(['pending', 'in-progress', 'done', 'failed', 'cancelled']).optional().describe('Filter by status'),
    queue: z.enum(['agent', 'human']).optional().describe('Filter by queue'),
    includeArchived: z.boolean().optional().describe('Also list tasks archived under tasks/done and tasks/failed'),
  },
  handler: async ({ status, queue, includeArchived }, ctx) => {
    const tasks = await listTasks(ctx.vault, { status, queue, includeArchived });
    return tasks.map(t => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      queue: t.queue,
      priority: t.priority,
      assignedTo: t.assignedTo,
      product: t.product,
      created: t.created,
      contextFiles: t.contextFiles,
      path: t.path,
    }));
  },
});

const tasksCreate = defineTool({
  name: 'obs_tasks_create',
  description: 'Create a structured task file in tasks/agent (AI may pick up autonomously) or tasks/human (needs a person).',
  scope: 'write',
  schema: {
    title: z.string().min(3).describe('Short imperative title'),
    queue: z.enum(['agent', 'human']).describe('agent = AI agents may claim it; human = needs a person'),
    description: z.string().min(3).describe('What needs to be done (task body)'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Default: medium'),
    product: z.string().optional().describe('Product/project this belongs to'),
    agentType: z.string().optional().describe('Which agent type may claim it, e.g. claude-code'),
    contextFiles: z.array(z.string()).optional().describe('Vault-relative paths the worker should read first'),
    acceptanceCriteria: z.array(z.string()).optional().describe('Checklist items that define done'),
  },
  handler: async (input, ctx) => {
    const task = createTask(ctx.vault, input);
    return { taskId: task.taskId, path: task.path, status: task.status };
  },
});

const tasksClaim = defineTool({
  name: 'obs_tasks_claim',
  description: 'Atomically claim a pending task: sets status in-progress, assigned_to, claimed_at. Exactly one concurrent claimer wins. Read the returned contextFiles before working.',
  scope: 'write',
  schema: {
    taskId: z.string().describe('task_id from obs_tasks_list'),
    agentId: z.string().describe('Identifier of the claiming agent, e.g. claude-web-session or claude-code'),
  },
  handler: async ({ taskId, agentId }, ctx) => {
    const task = await claimTask(ctx.vault, taskId, agentId);
    return {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      claimedAt: task.claimedAt,
      contextFiles: task.contextFiles,
      body: task.body,
      path: task.path,
    };
  },
});

const tasksComplete = defineTool({
  name: 'obs_tasks_complete',
  description: 'Mark a task done or failed and archive it to tasks/done/ or tasks/failed/ with a timestamp and optional notes.',
  scope: 'write',
  schema: {
    taskId: z.string().describe('task_id from obs_tasks_list'),
    outcome: z.enum(['done', 'failed']).describe('Final outcome'),
    notes: z.string().optional().describe('What was done / why it failed — appended to the task file'),
  },
  handler: async ({ taskId, outcome, notes }, ctx) => {
    const task = await completeTask(ctx.vault, taskId, outcome, notes);
    return { taskId: task.taskId, status: task.status, completedAt: task.completedAt, archivedTo: task.path };
  },
});

export const taskTools: Array<ToolDef<ZodRawShape>> = [
  tasksList,
  tasksCreate,
  tasksClaim,
  tasksComplete,
] as unknown as Array<ToolDef<ZodRawShape>>;
