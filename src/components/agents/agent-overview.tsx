'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AgentConfigState } from './use-agent-config';

interface OverviewCounts {
  skillsActive: number;
  skillsTotal: number;
  toolsEnabled: number;
  toolsTotal: number;
  knowledgeDocs: number;
}

async function loadCounts(): Promise<OverviewCounts> {
  const [skillsRes, toolsRes, knowledgeRes] = await Promise.all([
    fetch('/api/ai/skills').then((r) => r.json()).catch(() => null),
    fetch('/api/ai/tools').then((r) => r.json()).catch(() => null),
    fetch('/api/ai/knowledge').then((r) => r.json()).catch(() => null),
  ]);
  const skills = (skillsRes?.skills ?? []) as Array<{ enabled: boolean }>;
  const tools = (toolsRes?.tools ?? {}) as Record<string, { enabled: boolean }>;
  const toolValues = Object.values(tools);
  return {
    skillsActive: skills.filter((s) => s.enabled).length,
    skillsTotal: skills.length,
    toolsEnabled: toolValues.filter((tool) => tool.enabled).length,
    toolsTotal: toolValues.length,
    knowledgeDocs: (knowledgeRes?.documents ?? []).length,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * Visão Geral: a summary card instead of jumping straight into forms —
 * every value here already exists elsewhere (ai_configs, agent_tools,
 * skills, ai_knowledge_documents); this just aggregates and displays it.
 * No new backend, no new writes.
 */
export function AgentOverview({
  state,
  onNavigate,
}: {
  state: AgentConfigState;
  onNavigate: (tab: 'playground' | 'identity') => void;
}) {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);

  useEffect(() => {
    if (!state.configured) return;
    void loadCounts().then(setCounts);
  }, [state.configured]);

  if (state.loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.configured) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Bot className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Ainda não configuraste um agente de IA para esta conta.
          </p>
          <Button onClick={() => onNavigate('identity')}>Configurar agora</Button>
        </CardContent>
      </Card>
    );
  }

  const modelLabel = `${state.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · ${state.model}`;

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardContent className="space-y-1 pt-6">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {state.agentName || 'Agente sem nome'}
              </h3>
              {state.agentRole && (
                <p className="text-sm text-muted-foreground">{state.agentRole}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Row label="Estado" value={state.isActive ? 'Activo' : 'Inactivo'} />
            <Row label="Modelo" value={modelLabel} />
            <Row
              label="Temperatura"
              value={state.temperatureEnabled ? state.temperature.toFixed(2) : 'Por omissão'}
            />
          </div>

          <div className="mt-4 space-y-1">
            <Row
              label="Skills activas"
              value={counts ? `${counts.skillsActive} / ${counts.skillsTotal}` : '…'}
            />
            <Row
              label="Tools disponíveis"
              value={counts ? `${counts.toolsEnabled} / ${counts.toolsTotal}` : '…'}
            />
            <Row
              label="Fontes de conhecimento"
              value={counts ? String(counts.knowledgeDocs) : '…'}
            />
            <Row label="Auto-resposta" value={state.autoReplyEnabled ? 'Activa' : 'Inactiva'} />
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={() => onNavigate('playground')}>Testar agente</Button>
            <Button variant="outline" onClick={() => onNavigate('identity')}>
              Configurar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
