import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { listTasks, createTask, claimTask, completeTask } from '../../src/kb/tasks.js';

describe('Structured task queue', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tasks-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a task file with the frontmatter schema', async () => {
    const task = createTask(vault, {
      title: 'Write 2Captcha integration guide',
      queue: 'agent',
      description: 'Write a step-by-step guide.',
      priority: 'high',
      product: 'superagentk',
      contextFiles: ['wiki/projects/superagentk-product.md'],
      acceptanceCriteria: ['Python example included'],
    });

    expect(task.taskId).toMatch(/-write-2captcha-integration-guide$/);
    expect(task.status).toBe('pending');
    expect(task.path).toBe(`tasks/agent/${task.taskId}.md`);

    const raw = vault.readFileRaw(task.path);
    expect(raw).toContain('task_id:');
    expect(raw).toContain('status: pending');
    expect(raw).toContain('priority: high');
    expect(raw).toContain('wiki/projects/superagentk-product.md');
    expect(raw).toContain('- [ ] Python example included');

    const listed = await listTasks(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0].contextFiles).toEqual(['wiki/projects/superagentk-product.md']);
  });

  it('lists tasks filtered by status and queue, sorted by priority', async () => {
    createTask(vault, { title: 'Low prio agent', queue: 'agent', description: 'x', priority: 'low' });
    createTask(vault, { title: 'Critical agent', queue: 'agent', description: 'x', priority: 'critical' });
    createTask(vault, { title: 'Human thing', queue: 'human', description: 'x', priority: 'medium' });

    const all = await listTasks(vault);
    expect(all.map(t => t.priority)).toEqual(['critical', 'medium', 'low']);

    const agentOnly = await listTasks(vault, { queue: 'agent' });
    expect(agentOnly).toHaveLength(2);

    const pending = await listTasks(vault, { status: 'pending' });
    expect(pending).toHaveLength(3);
  });

  it('claims a pending task: status, assigned_to, claimed_at', async () => {
    const created = createTask(vault, { title: 'Claim me', queue: 'agent', description: 'x' });
    const claimed = await claimTask(vault, created.taskId, 'claude-code');

    expect(claimed.status).toBe('in-progress');
    expect(claimed.assignedTo).toBe('claude-code');
    expect(claimed.claimedAt).toBeTruthy();
    // lock is released
    expect(existsSync(join(tempDir, 'tasks', '.locks', `${created.taskId}.lock`))).toBe(false);
  });

  it('exactly one of two concurrent claimers wins', async () => {
    const created = createTask(vault, { title: 'Race target', queue: 'agent', description: 'x' });

    const results = await Promise.allSettled([
      claimTask(vault, created.taskId, 'agent-a'),
      claimTask(vault, created.taskId, 'agent-b'),
    ]);

    const wins = results.filter(r => r.status === 'fulfilled');
    const losses = results.filter(r => r.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);

    const after = await listTasks(vault);
    expect(after[0].status).toBe('in-progress');
    expect(['agent-a', 'agent-b']).toContain(after[0].assignedTo);
  });

  it('rejects claiming a non-pending task', async () => {
    const created = createTask(vault, { title: 'Once only', queue: 'agent', description: 'x' });
    await claimTask(vault, created.taskId, 'agent-a');
    await expect(claimTask(vault, created.taskId, 'agent-b')).rejects.toThrow(/not pending/);
  });

  it('completes a task: archives to tasks/done with notes and timestamp', async () => {
    const created = createTask(vault, { title: 'Finish me', queue: 'agent', description: 'x' });
    await claimTask(vault, created.taskId, 'agent-a');
    const done = await completeTask(vault, created.taskId, 'done', 'All good.');

    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
    expect(done.path).toBe(`tasks/done/${created.taskId}.md`);
    expect(vault.readFileRaw(done.path)).toContain('All good.');
    expect(existsSync(join(tempDir, 'tasks', 'agent', `${created.taskId}.md`))).toBe(false);

    const active = await listTasks(vault);
    expect(active).toHaveLength(0);
    const archived = await listTasks(vault, { includeArchived: true });
    expect(archived).toHaveLength(1);
  });

  it('fails a task: archives to tasks/failed', async () => {
    const created = createTask(vault, { title: 'Doomed', queue: 'agent', description: 'x' });
    const failed = await completeTask(vault, created.taskId, 'failed', 'Blocked on credentials.');
    expect(failed.status).toBe('failed');
    expect(failed.path).toBe(`tasks/failed/${created.taskId}.md`);
    expect(vault.readFileRaw(failed.path)).toContain('Blocked on credentials.');
  });

  it('ignores malformed task files', async () => {
    mkdirSync(join(tempDir, 'tasks', 'agent'), { recursive: true });
    writeFileSync(join(tempDir, 'tasks', 'agent', 'not-a-task.md'), '# Just a note\nNo frontmatter.\n');
    createTask(vault, { title: 'Real task', queue: 'agent', description: 'x' });

    const listed = await listTasks(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe('Real task');
    // the malformed file is left untouched
    expect(readdirSync(join(tempDir, 'tasks', 'agent'))).toContain('not-a-task.md');
  });
});
