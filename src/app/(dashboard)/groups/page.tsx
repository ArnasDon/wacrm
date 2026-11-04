'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Megaphone, Plus, Trash2, UsersRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { stashBroadcastGroupIds } from '@/lib/broadcast-selected-groups';
import type { ContactGroup } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslations } from 'next-intl';

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

interface GroupRow extends ContactGroup {
  member_count: number;
}

export default function GroupsPage() {
  const router = useRouter();
  const t = useTranslations('Groups.page');
  const tGate = useTranslations('GatedButton');
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEdit = useCan('send-messages');

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[5]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('contact_groups')
      .select('*')
      .order('name');

    if (error) {
      toast.error(t('toastLoadFailed'));
      setGroups([]);
      setLoading(false);
      return;
    }

    const groupRows = (rows as ContactGroup[]) ?? [];
    if (groupRows.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: joins, error: joinError } = await supabase
      .from('contact_group_members')
      .select('group_id')
      .in(
        'group_id',
        groupRows.map((group) => group.id),
      );

    if (joinError) {
      toast.error(t('toastLoadFailed'));
      setGroups(groupRows.map((group) => ({ ...group, member_count: 0 })));
      setLoading(false);
      return;
    }

    const counts = new Map<string, number>();
    for (const row of joins ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }

    setGroups(
      groupRows.map((group) => ({
        ...group,
        member_count: counts.get(group.id) ?? 0,
      })),
    );
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error(t('toastNameRequired'));
      return;
    }
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('contact_groups')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name,
        color: newColor,
      })
      .select('*')
      .single();

    setSaving(false);
    if (error || !data) {
      toast.error(t('toastCreateFailed'));
      return;
    }

    toast.success(t('toastCreated'));
    setCreateOpen(false);
    setNewName('');
    setNewColor(PRESET_COLORS[5]);
    router.push(`/groups/${data.id}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('contact_groups')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleting(false);

    if (error) {
      toast.error(t('toastDeleteFailed'));
      return;
    }

    toast.success(t('toastDeleted'));
    setDeleteTarget(null);
    void fetchGroups();
  }

  function startBroadcast(group: GroupRow) {
    if (group.member_count === 0) {
      toast.error(t('toastEmptyBroadcast'));
      return;
    }
    stashBroadcastGroupIds([group.id]);
    router.push('/broadcasts/new');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason={tGate('reasons.addOrImportContacts')}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          {t('createGroup')}
        </GatedButton>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">{t('columns.name')}</TableHead>
              <TableHead className="text-muted-foreground">{t('columns.members')}</TableHead>
              <TableHead className="w-40 text-muted-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={3} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : groups.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={3} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <UsersRound className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t('empty')}</p>
                    <GatedButton
                      canAct={canEdit}
                      gateReason={tGate('reasons.addOrImportContacts')}
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                      className="mt-2"
                    >
                      <Plus className="size-3.5" />
                      {t('createFirst')}
                    </GatedButton>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <TableRow
                  key={group.id}
                  className="cursor-pointer border-border hover:bg-muted/50"
                  onClick={() => router.push(`/groups/${group.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="font-medium text-foreground">{group.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t('memberCount', { count: group.member_count })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason={tGate('reasons.createBroadcasts')}
                        onClick={() => startBroadcast(group)}
                        className="text-muted-foreground hover:text-foreground"
                        title={t('broadcast')}
                      >
                        <Megaphone className="size-4" />
                      </GatedButton>
                      <GatedButton
                        variant="ghost"
                        size="icon-sm"
                        canAct={canEdit}
                        gateReason={tGate('reasons.deleteContacts')}
                        onClick={() => setDeleteTarget(group)}
                        className="text-muted-foreground hover:text-destructive"
                        title={t('delete')}
                      >
                        <Trash2 className="size-4" />
                      </GatedButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('namePlaceholder')}
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewColor(color)}
                  aria-label={t('pickColor')}
                  aria-pressed={newColor === color}
                  className={`size-6 rounded-md transition-transform hover:scale-110 ${
                    newColor === color
                      ? 'outline outline-2 outline-offset-2 outline-primary'
                      : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving || !newName.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t('deleteDesc', { name: deleteTarget.name })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
