'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';
import { WhatsAppConfig } from './whatsapp-config';
import { UazapiConnectionCard } from './uazapi-connection-card';
import { DefaultChannelSelector } from './default-channel-selector';

/**
 * State owner for the WhatsApp settings section. It fetches the account's
 * connection list once on mount and hands it — plus a memoized `refetch`
 * — down to the two provider cards and the default-channel selector.
 *
 * `refetch` MUST stay referentially stable: `UazapiConnectionCard` keeps
 * `onChanged` in a polling effect's dependency array, so a fresh closure
 * every render would tear its intervals down and rebuild them constantly.
 */
export function WhatsAppConnectionsPanel() {
  const t = useTranslations('Settings.whatsapp');
  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/connections');
      if (!res.ok) throw new Error(`GET failed (${res.status})`);
      const body = (await res.json()) as { data?: ConnectionDTO[] };
      setConnections(body.data ?? []);
      setError(false);
    } catch (err) {
      console.error('Failed to load WhatsApp connections:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="space-y-6">
      <WhatsAppConfig />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-primary size-5 animate-spin" />
        </div>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t('uazapiActionFailed')}</AlertTitle>
              <AlertDescription>{t('connectionsLoadError')}</AlertDescription>
            </Alert>
          )}
          <UazapiConnectionCard connections={connections} onChanged={refetch} />
          <DefaultChannelSelector
            connections={connections}
            onChanged={refetch}
          />
        </>
      )}
    </div>
  );
}
