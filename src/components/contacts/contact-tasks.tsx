'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IconPlus, IconLoader2, IconTrash, IconClockHour4 } from '@tabler/icons-react';

import { useAuth } from '@/hooks/use-auth';
import { useTasks } from '@/hooks/use-tasks';
import { isOverdue, type Task } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

function dueLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ContactTasks({ contactId }: { contactId: string | null }) {
  const t = useTranslations('Contacts.detailView.tasks');
  const { user } = useAuth();
  const { tasks, loading, create, toggleDone, remove } = useTasks(contactId);

  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  const { open, done } = useMemo(() => {
    const o: Task[] = [];
    const d: Task[] = [];
    for (const task of tasks) (task.status === 'done' ? d : o).push(task);
    return { open: o, done: d };
  }, [tasks]);

  async function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    const created = await create({
      title: trimmed,
      due_at: due ? new Date(due).toISOString() : null,
      assigned_to: user?.id ?? null,
    });
    setSaving(false);
    if (created) {
      setTitle('');
      setDue('');
    }
  }

  function Row({ task }: { task: Task }) {
    const overdue = isOverdue(task);
    return (
      <li className="group hover:bg-muted/50 flex items-start gap-2.5 rounded-md px-1 py-1.5">
        <Checkbox
          checked={task.status === 'done'}
          onCheckedChange={() => toggleDone(task)}
          aria-label={task.title}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-foreground text-sm',
              task.status === 'done' && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </p>
          {task.due_at ? (
            <p
              className={cn(
                'mt-0.5 flex items-center gap-1 text-xs',
                overdue ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <IconClockHour4 className="size-3" />
              {dueLabel(task.due_at)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => remove(task.id)}
          aria-label={t('delete')}
          className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
        >
          <IconTrash className="size-3.5" />
        </button>
      </li>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="mb-3 space-y-2"
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('placeholder')}
          maxLength={200}
          className="bg-muted border-border h-8 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="border-border bg-muted text-foreground h-8 flex-1 rounded-md border px-2 text-sm"
            aria-label={t('due')}
          />
          <Button type="submit" size="sm" disabled={!title.trim() || saving}>
            {saving ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconPlus className="size-3.5" />
            )}
            {t('add')}
          </Button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">{t('empty')}</p>
        ) : (
          <>
            <ol className="space-y-0.5">
              {open.map((task) => (
                <Row key={task.id} task={task} />
              ))}
            </ol>
            {done.length > 0 ? (
              <>
                <p className="text-muted-foreground mt-4 mb-1 px-1 text-xs font-medium">
                  {t('completed', { count: done.length })}
                </p>
                <ol className="space-y-0.5 opacity-70">
                  {done.map((task) => (
                    <Row key={task.id} task={task} />
                  ))}
                </ol>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
