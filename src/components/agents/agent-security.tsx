'use client';

import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { memberLabel } from '@/lib/account/members';
import type { AgentConfigState } from './use-agent-config';
import { HANDOFF_QUEUE } from './use-agent-config';

const REAL_HANDOFF_RULES = [
  'O cliente pede explicitamente para falar com uma pessoa, ou reclama de algo.',
  'O pedido envolve a conta, um pagamento, reembolso ou dados sensíveis (ex.: senha, cartão).',
  'O próprio agente decide, a meio da conversa, que precisa de intervenção humana.',
  'Uma verificação de segurança automática bloqueia a resposta — por exemplo, um preço que nenhuma ferramenta confirmou, uma promessa de disponibilidade não verificada, uma garantia absoluta ("100% garantido"), ou uma fuga de instruções internas.',
  'O limite de respostas automáticas desta conversa é atingido.',
  'Ocorre uma falha técnica inesperada a meio da resposta.',
];

/**
 * Segurança & Handoff: the two dials that actually live in ai_configs
 * (reply cap, handoff destination) plus a READ-ONLY mirror of the real
 * handoff/guardrail rules in src/lib/ai/route.ts and
 * src/lib/ai/guardrails.ts. Deliberately not editable — per the
 * evaluation this was built from, a business admin should never be able
 * to switch off a safety rule by accident through this screen. Keep
 * REAL_HANDOFF_RULES in sync with those two files by hand; this list has
 * no runtime effect, it only documents what already runs.
 */
export function AgentSecurity({ state }: { state: AgentConfigState }) {
  const { t } = state;
  const disabled = !state.canEdit || state.saving;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('maxAutoReplies')}</CardTitle>
          <CardDescription>{t('maxAutoRepliesDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="ai-max" className="sr-only">
            {t('maxAutoReplies')}
          </Label>
          <Input
            id="ai-max"
            type="number"
            min={1}
            max={20}
            value={state.maxPerConversation}
            onChange={(e) =>
              state.setMaxPerConversation(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
            }
            disabled={disabled || !state.autoReplyEnabled}
            className="w-20"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('handoffTo')}</CardTitle>
          <CardDescription>{t('handoffToDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={state.handoffAgentId || HANDOFF_QUEUE}
            onValueChange={(v) => state.setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)}
            disabled={disabled || !state.autoReplyEnabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HANDOFF_QUEUE}>{t('handoffQueue')}</SelectItem>
              {state.members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {memberLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Regras de segurança activas
          </CardTitle>
          <CardDescription>
            Estas regras estão sempre activas e não podem ser desligadas por aqui — é
            deliberado, para que um erro de configuração nunca desactive uma protecção. O
            agente encaminha para atendimento humano sempre que:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
            {REAL_HANDOFF_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void state.handleSave()} disabled={disabled}>
          {state.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
