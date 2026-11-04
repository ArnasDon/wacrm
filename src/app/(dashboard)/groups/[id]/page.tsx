'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  FileUp,
  Loader2,
  Megaphone,
  Plus,
  Search,
  UserMinus,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { upsertContactsByPhone } from '@/lib/contacts/upsert-by-phone';
import { parseBroadcastCsv } from '@/lib/broadcast-csv';
import { stashBroadcastGroupIds } from '@/lib/broadcast-selected-groups';
import type { Contact, ContactGroup } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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

type AddMode = 'select' | 'csv';

/** Page size for browse + search — never dump the whole contact book. */
const CANDIDATE_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

async function addGroupMembers(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  contactIds: readonly string[],
): Promise<void> {
  if (contactIds.length === 0) return;
  const rows = contactIds.map((contact_id) => ({
    group_id: groupId,
    contact_id,
  }));
  const { error } = await supabase
    .from('contact_group_members')
    .upsert(rows, { onConflict: 'group_id,contact_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function removeGroupMember(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  contactId: string,
): Promise<void> {
  const { error } = await supabase
    .from('contact_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('contact_id', contactId);
  if (error) throw new Error(error.message);
}

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;
  const router = useRouter();
  const t = useTranslations('Groups.detail');
  const tGate = useTranslations('GatedButton');
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEdit = useCan('send-messages');

  const [group, setGroup] = useState<ContactGroup | null>(null);
  const [members, setMembers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('select');
  const [candidates, setCandidates] = useState<Contact[]>([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [candidateHasMore, setCandidateHasMore] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingMoreCandidates, setLoadingMoreCandidates] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvCount, setCsvCount] = useState(0);
  const [csvRows, setCsvRows] = useState<{ phone: string; name?: string }[]>(
    [],
  );
  const csvInputRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const fetchGroup = useCallback(async () => {
    setLoading(true);
    const { data: row, error } = await supabase
      .from('contact_groups')
      .select('*')
      .eq('id', groupId)
      .maybeSingle();

    if (error || !row) {
      toast.error(t('toastNotFound'));
      setGroup(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setGroup(row as ContactGroup);

    const { data: joins, error: joinError } = await supabase
      .from('contact_group_members')
      .select('contact_id')
      .eq('group_id', groupId);

    if (joinError) {
      toast.error(t('toastLoadFailed'));
      setMembers([]);
      setLoading(false);
      return;
    }

    const ids = [...new Set((joins ?? []).map((r) => r.contact_id))];
    if (ids.length === 0) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const { data: contacts, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .in('id', ids)
      .order('name');

    if (contactError) {
      toast.error(t('toastLoadFailed'));
      setMembers([]);
    } else {
      setMembers((contacts as Contact[]) ?? []);
    }
    setLoading(false);
  }, [groupId, supabase, t]);

  useEffect(() => {
    void fetchGroup();
  }, [fetchGroup]);

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.id)),
    [members],
  );

  function resetAddDialog() {
    searchSeq.current += 1;
    setPicked(new Set());
    setCandidateSearch('');
    setCandidates([]);
    setCandidateOffset(0);
    setCandidateHasMore(false);
    setLoadingCandidates(false);
    setLoadingMoreCandidates(false);
    setCsvFileName(null);
    setCsvCount(0);
    setCsvRows([]);
    setAddMode('select');
    if (csvInputRef.current) csvInputRef.current.value = '';
  }

  function openAddMembers(mode: AddMode = 'select') {
    setAddOpen(true);
    resetAddDialog();
    setAddMode(mode);
  }

  const loadCandidates = useCallback(
    async (rawTerm: string, offset: number, append: boolean) => {
      const term = rawTerm.trim();
      const seq = ++searchSeq.current;

      if (append) setLoadingMoreCandidates(true);
      else setLoadingCandidates(true);

      // Escape LIKE wildcards + quotes for PostgREST so commas/spaces/"
      // in the term cannot break the `.or(...)` filter list.
      let query = supabase
        .from('contacts')
        .select('id, name, phone, email', { count: 'exact' })
        .order('name')
        .range(offset, offset + CANDIDATE_PAGE_SIZE - 1);

      if (term) {
        const escaped = term
          .replace(/\\/g, '\\\\')
          .replace(/[%_]/g, '\\$&')
          .replace(/"/g, '');
        const like = `%${escaped}%`;
        query = query.or(
          `name.ilike."${like}",phone.ilike."${like}",email.ilike."${like}"`,
        );
      }

      const { data, error, count } = await query;

      if (seq !== searchSeq.current) return;

      setLoadingCandidates(false);
      setLoadingMoreCandidates(false);
      if (error) {
        toast.error(t('toastLoadFailed'));
        if (!append) setCandidates([]);
        setCandidateHasMore(false);
        return;
      }

      const rows = ((data as Contact[]) ?? []).filter(
        (c) => !memberIds.has(c.id),
      );
      setCandidates((prev) => (append ? [...prev, ...rows] : rows));
      const nextOffset = offset + CANDIDATE_PAGE_SIZE;
      setCandidateOffset(nextOffset);
      setCandidateHasMore(count != null ? nextOffset < count : rows.length > 0);
    },
    [memberIds, supabase, t],
  );

  // Default: first page of all contacts. Typing: server-side search.
  // "Load more" pages through the rest so nobody is stuck behind A/B.
  useEffect(() => {
    if (!addOpen || addMode !== 'select') return;
    const handle = window.setTimeout(() => {
      void loadCandidates(candidateSearch, 0, false);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [addOpen, addMode, candidateSearch, loadCandidates]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = parseBroadcastCsv(await file.text());
    if (!result.ok) {
      toast.error(
        result.error === 'missing_phone_column'
          ? t('toastCsvMissingPhone')
          : t('toastCsvNoRows'),
      );
      e.target.value = '';
      setCsvFileName(null);
      setCsvRows([]);
      setCsvCount(0);
      return;
    }

    if (result.invalid > 0) {
      toast.warning(t('toastCsvInvalidPhones', { count: result.invalid }));
    }
    if (result.duplicates > 0) {
      toast.message(t('toastCsvDuplicates', { count: result.duplicates }));
    }

    setCsvFileName(file.name);
    setCsvRows(result.contacts);
    setCsvCount(result.contacts.length);
  }

  async function handleAddMembers() {
    if (addMode === 'select') {
      if (picked.size === 0) return;
      setSavingMembers(true);
      try {
        await addGroupMembers(supabase, groupId, [...picked]);
        toast.success(t('toastMembersAdded', { count: picked.size }));
        setAddOpen(false);
        await fetchGroup();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('toastAddFailed');
        toast.error(message);
      } finally {
        setSavingMembers(false);
      }
      return;
    }

    if (csvRows.length === 0) return;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      return;
    }

    setSavingMembers(true);
    try {
      const contacts = await upsertContactsByPhone(supabase, {
        accountId,
        userId: user.id,
        rows: csvRows,
      });

      const toAdd = contacts
        .filter((contact) => !memberIds.has(contact.id))
        .map((contact) => contact.id);

      if (toAdd.length === 0) {
        toast.message(t('toastCsvAlreadyMembers'));
      } else {
        await addGroupMembers(supabase, groupId, toAdd);
        toast.success(t('toastMembersAdded', { count: toAdd.length }));
      }
      setAddOpen(false);
      await fetchGroup();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('toastCsvFailed');
      toast.error(message);
    } finally {
      setSavingMembers(false);
    }
  }

  async function handleRemove(contactId: string) {
    setRemovingId(contactId);
    try {
      await removeGroupMember(supabase, groupId, contactId);
      toast.success(t('toastMemberRemoved'));
      setMembers((prev) => prev.filter((m) => m.id !== contactId));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('toastRemoveFailed');
      toast.error(message);
    } finally {
      setRemovingId(null);
    }
  }

  function startBroadcast() {
    if (!group) return;
    if (members.length === 0) {
      toast.error(t('toastEmptyBroadcast'));
      return;
    }
    stashBroadcastGroupIds([group.id]);
    router.push('/broadcasts/new');
  }

  const canSubmitAdd =
    addMode === 'select' ? picked.size > 0 : csvRows.length > 0;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/groups')}>
          <ArrowLeft className="size-4" />
          {t('back')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/groups')}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
            {t('back')}
          </Button>
          <div className="flex items-center gap-2">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            <h1 className="text-2xl font-bold text-foreground">{group.name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('memberCount', { count: members.length })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GatedButton
            canAct={canEdit}
            gateReason={tGate('reasons.addOrImportContacts')}
            variant="outline"
            onClick={() => void openAddMembers('select')}
          >
            <Plus className="size-4" />
            {t('addMembers')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason={tGate('reasons.addOrImportContacts')}
            variant="outline"
            onClick={() => void openAddMembers('csv')}
          >
            <FileUp className="size-4" />
            {t('importCsv')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason={tGate('reasons.createBroadcasts')}
            onClick={startBroadcast}
          >
            <Megaphone className="size-4" />
            {t('broadcast')}
          </GatedButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">
                {t('columns.name')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('columns.phone')}
              </TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                {t('columns.email')}
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={4} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t('emptyMembers')}
                    </p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <GatedButton
                        canAct={canEdit}
                        gateReason={tGate('reasons.addOrImportContacts')}
                        variant="outline"
                        size="sm"
                        onClick={() => void openAddMembers('select')}
                      >
                        <Plus className="size-3.5" />
                        {t('addMembers')}
                      </GatedButton>
                      <GatedButton
                        canAct={canEdit}
                        gateReason={tGate('reasons.addOrImportContacts')}
                        variant="outline"
                        size="sm"
                        onClick={() => void openAddMembers('csv')}
                      >
                        <FileUp className="size-3.5" />
                        {t('importCsv')}
                      </GatedButton>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              members.map((contact) => (
                <TableRow key={contact.id} className="border-border">
                  <TableCell className="font-medium text-foreground">
                    {contact.name || (
                      <span className="italic text-muted-foreground">
                        {t('unnamed')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {contact.email || '—'}
                  </TableCell>
                  <TableCell>
                    <GatedButton
                      variant="ghost"
                      size="icon-sm"
                      canAct={canEdit}
                      gateReason={tGate('reasons.deleteContacts')}
                      onClick={() => void handleRemove(contact.id)}
                      disabled={removingId === contact.id}
                      className="text-muted-foreground hover:text-destructive"
                      title={t('removeMember')}
                    >
                      {removingId === contact.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <UserMinus className="size-4" />
                      )}
                    </GatedButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {addMode === 'csv' ? t('importCsvTitle') : t('addMembersTitle')}
            </DialogTitle>
            <DialogDescription>
              {addMode === 'csv' ? t('importCsvDesc') : t('addMembersDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={addMode === 'select' ? 'default' : 'outline'}
              onClick={() => openAddMembers('select')}
            >
              {t('modeSelect')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={addMode === 'csv' ? 'default' : 'outline'}
              onClick={() => {
                setAddMode('csv');
                setPicked(new Set());
              }}
            >
              {t('modeCsv')}
            </Button>
          </div>

          {addMode === 'select' ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder={t('searchContacts')}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('searchHint')}</p>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {loadingCandidates ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t('noCandidates')}
                  </p>
                ) : (
                  <>
                    {candidates.map((contact) => (
                      <label
                        key={contact.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={picked.has(contact.id)}
                          onCheckedChange={() => togglePick(contact.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {contact.name || t('unnamed')}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {contact.phone}
                          </p>
                        </div>
                      </label>
                    ))}
                    {candidateHasMore && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full text-muted-foreground"
                        disabled={loadingMoreCandidates}
                        onClick={() =>
                          void loadCandidates(
                            candidateSearch,
                            candidateOffset,
                            true,
                          )
                        }
                      >
                        {loadingMoreCandidates ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        {t('loadMore')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/30 p-4">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleCsvChange(e)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => csvInputRef.current?.click()}
                className="w-full"
              >
                <FileUp className="size-4" />
                {t('chooseCsv')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('csvFormatHint')}</p>
              {csvFileName && (
                <p className="text-sm text-foreground">
                  {t('csvReady', { name: csvFileName, count: csvCount })}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void handleAddMembers()}
              disabled={savingMembers || !canSubmitAdd}
            >
              {savingMembers ? (
                <Loader2 className="size-4 animate-spin" />
              ) : addMode === 'csv' ? (
                <FileUp className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
              {addMode === 'csv'
                ? t('importCount', { count: csvCount })
                : t('addSelected', { count: picked.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
