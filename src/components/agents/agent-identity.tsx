'use client';

import { Loader2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentConfigState } from './use-agent-config';

/**
 * Identidade & Comportamento: who the agent is (name, role, language,
 * an admin-facing note) and how it talks (the free-text prompt +
 * commercial strategy dials). Deliberately does NOT include provider/
 * model/credentials (Modelo & Runtime) or the handoff destination
 * (Segurança & Handoff) — see the Agentes page's tab split.
 */
export function AgentIdentity({ state }: { state: AgentConfigState }) {
  const { t } = state;
  const disabled = !state.canEdit || state.saving;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 text-primary" /> Identidade
          </CardTitle>
          <CardDescription>
            Quem é este agente. Estes campos não são regras de comportamento — só ajudam o
            modelo a apresentar-se e ajudam-te a ti a identificar o agente na interface.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Nome do agente</Label>
              <Input
                id="agent-name"
                value={state.agentName}
                onChange={(e) => state.setAgentName(e.target.value)}
                placeholder="Ex.: Assistente LC"
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-role">Função</Label>
              <Input
                id="agent-role"
                value={state.agentRole}
                onChange={(e) => state.setAgentRole(e.target.value)}
                placeholder="Ex.: Assistente Comercial Digital"
                disabled={disabled}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-language">Idioma principal</Label>
              <Input
                id="agent-language"
                value={state.agentLanguage}
                onChange={(e) => state.setAgentLanguage(e.target.value)}
                placeholder="Ex.: Português"
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Usado apenas quando o idioma do cliente é ambíguo — o agente continua sempre a
                responder na língua em que o cliente escreve.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-description">Descrição interna</Label>
              <Input
                id="agent-description"
                value={state.agentDescription}
                onChange={(e) => state.setAgentDescription(e.target.value)}
                placeholder="Nota só para a tua equipa — nunca é enviada ao cliente"
                disabled={disabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('behaviour')}</CardTitle>
          <CardDescription>{t('behaviourDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
            <Textarea
              id="ai-prompt"
              value={state.systemPrompt}
              onChange={(e) => state.setSystemPrompt(e.target.value)}
              placeholder={t('promptPlaceholder')}
              rows={6}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estratégia comercial</CardTitle>
          <CardDescription>
            Define como o assistente apresenta, recomenda e acompanha produtos durante uma
            conversa. Mantém-se a dials paramétricos — orientação de negócio mais elaborada
            deve viver numa Skill, não aqui, para não duplicar as duas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-max-products">Máximo de produtos apresentados</Label>
              <p className="text-xs text-muted-foreground">
                Limita a quantidade de opções mostradas de cada vez.
              </p>
            </div>
            <Input
              id="ai-max-products"
              type="number"
              min={1}
              max={10}
              value={state.maxProducts}
              onChange={(e) =>
                state.setMaxProducts(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
              }
              disabled={disabled}
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Preferir apresentação visual</p>
              <p className="text-xs text-muted-foreground">
                Dá prioridade ao catálogo visual e às fotografias dos produtos.
              </p>
            </div>
            <Switch
              checked={state.preferVisual}
              onCheckedChange={state.setPreferVisual}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Recomendações automáticas</p>
              <p className="text-xs text-muted-foreground">
                Recomenda produtos adequados quando o cliente descreve uma necessidade.
              </p>
            </div>
            <Switch
              checked={state.autoRecommend}
              onCheckedChange={state.setAutoRecommend}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Confirmar stock</p>
              <p className="text-xs text-muted-foreground">
                Obriga o assistente a consultar o stock antes de confirmar disponibilidade.
              </p>
            </div>
            <Switch
              checked={state.checkStock}
              onCheckedChange={state.setCheckStock}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Manter produto seleccionado</p>
              <p className="text-xs text-muted-foreground">
                Mantém o produto escolhido como contexto principal até o cliente mudar de produto.
              </p>
            </div>
            <Switch
              checked={state.keepSelectedProduct}
              onCheckedChange={state.setKeepSelectedProduct}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-qualification-order">Ordem de qualificação</Label>
            <p className="text-xs text-muted-foreground">
              Ordem usada para recolher tamanho e cor quando ambos ainda são desconhecidos.
            </p>
            <Select
              value={state.qualificationOrder}
              onValueChange={(value) =>
                state.setQualificationOrder(value as typeof state.qualificationOrder)
              }
              disabled={disabled}
            >
              <SelectTrigger id="ai-qualification-order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="size_then_color">Tamanho → cor</SelectItem>
                <SelectItem value="color_then_size">Cor → tamanho</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
