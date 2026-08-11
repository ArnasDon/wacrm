'use client';

import { Mail, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChannelActivity as ChannelActivityData } from '@/lib/dashboard/types';

// ============================================================
// Correo y llamadas — actividad, no adquisición.
//
// Eran dos pestañas de /reports que mostraban contadores sueltos sin
// conectarlos con ningún resultado. Aquí viven junto al resto de tarjetas del
// panel, que es lo que son: el pulso del día.
// ============================================================

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className={`text-xl font-bold tabular-nums ${tone ?? 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function ChannelActivity({
  data,
  loading,
}: {
  data: ChannelActivityData | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-16 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Mail className="h-4 w-4 text-primary" />
            Correo · {data.days} días
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Stat label="Enviados" value={data.email.sent} />
          <Stat label="Entregados" value={data.email.delivered} tone="text-emerald-500" />
          <Stat label="Rebotados" value={data.email.bounced} tone="text-red-400" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Phone className="h-4 w-4 text-primary" />
            Llamadas · {data.days} días
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Stat label="Total" value={data.calls.total} />
          <Stat label="Contestadas" value={data.calls.answered} tone="text-emerald-500" />
          <Stat label="Perdidas" value={data.calls.missed} tone="text-red-400" />
        </CardContent>
      </Card>
    </div>
  );
}
