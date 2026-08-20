'use client';

// §11 P1: WhatsApp Commerce catalogue sync status + trigger. Real
// architecture, stubbed outbound call (Phase 8 — see
// src/lib/products/catalogue-service.ts's header for why). A sync
// attempt always produces a real, visible status — "Sync Error" with
// Meta's/the stub's actual message, never a silent no-op or a faked
// "Synced."

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export interface SyncLog {
  sync_status:
    | 'Draft'
    | 'Pending Review'
    | 'Published'
    | 'Synced'
    | 'Sync Error'
    | 'Archived';
  sync_error: string | null;
  last_synced_at: string | null;
  whatsapp_catalogue_id: string | null;
}

const STATUS_VARIANT: Record<
  SyncLog['sync_status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  Draft: 'outline',
  'Pending Review': 'secondary',
  Published: 'secondary',
  Synced: 'default',
  'Sync Error': 'destructive',
  Archived: 'outline',
};

interface CatalogueSyncCardProps {
  productId: string;
  syncLog: SyncLog | null;
  loading: boolean;
  canSync: boolean;
  onSynced: (log: SyncLog) => void;
}

export function CatalogueSyncCard({
  productId,
  syncLog,
  loading,
  canSync,
  onSynced,
}: CatalogueSyncCardProps) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/products/${productId}/catalogue-sync`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Sync failed.');
        return;
      }
      onSynced(data.sync_log);
      if (data.warning) {
        toast.error(data.warning);
      } else {
        toast.success('Synced to WhatsApp catalogue.');
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">WhatsApp Catalogue</CardTitle>
        <CardDescription>
          Sync status against Meta&apos;s WhatsApp Commerce catalogue (§11, P1 —
          architected, not yet connected to a live Meta Commerce Manager
          account).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center py-4">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  syncLog ? STATUS_VARIANT[syncLog.sync_status] : 'outline'
                }
              >
                {syncLog?.sync_status ?? 'Never synced'}
              </Badge>
              {syncLog?.last_synced_at && (
                <span className="text-muted-foreground text-xs">
                  Last synced{' '}
                  {new Date(syncLog.last_synced_at).toLocaleString()}
                </span>
              )}
            </div>
            {syncLog?.sync_error && (
              <p className="text-muted-foreground text-xs">
                {syncLog.sync_error}
              </p>
            )}
          </>
        )}
        {canSync && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sync now
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
