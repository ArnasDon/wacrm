'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

/**
 * The default-channel selector is only worth showing when the account
 * can actually choose: it needs a live Meta connection AND a live UAZAPI
 * connection. With a single provider connected there is nothing to pick,
 * and `resolveConnection` already has exactly one candidate.
 */
export function shouldShowChannelSelector(
  connections: ConnectionDTO[]
): boolean {
  const hasConnected = (provider: ConnectionDTO['provider']) =>
    connections.some(
      (conn) => conn.provider === provider && conn.status === 'connected'
    );
  return hasConnected('meta') && hasConnected('uazapi');
}

export function DefaultChannelSelector({
  connections,
  onChanged,
}: {
  connections: ConnectionDTO[];
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.whatsapp');
  const [saving, setSaving] = useState(false);

  if (!shouldShowChannelSelector(connections)) return null;

  const meta = connections.find(
    (conn) => conn.provider === 'meta' && conn.status === 'connected'
  );
  const uazapi = connections.find(
    (conn) => conn.provider === 'uazapi' && conn.status === 'connected'
  );
  // `shouldShowChannelSelector` already guarantees both, but narrow for TS.
  if (!meta || !uazapi) return null;

  const selected = meta.is_primary ? 'meta' : uazapi.is_primary ? 'uazapi' : '';

  async function handleChange(value: string) {
    const target = value === 'meta' ? meta : uazapi;
    if (!target || target.is_primary || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/whatsapp/connections/${target.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_primary: true }),
      });
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
      onChanged();
    } catch (err) {
      console.error('Failed to set the default channel:', err);
      toast.error(t('uazapiActionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">
          {t('channelSelectorTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('channelSelectorDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={selected}
          onValueChange={handleChange}
          aria-label={t('channelSelectorTitle')}
        >
          <Label className="border-border flex items-center gap-3 rounded-md border p-3">
            <RadioGroupItem value="meta" disabled={saving} />
            <span className="text-foreground text-sm font-medium">
              {t('channelSelectorMeta')}
            </span>
          </Label>
          <Label className="border-border flex items-center gap-3 rounded-md border p-3">
            <RadioGroupItem value="uazapi" disabled={saving} />
            <span className="text-foreground text-sm font-medium">
              {t('channelSelectorUazapi')}
            </span>
          </Label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
