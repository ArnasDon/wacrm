'use client';

import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AgentTools } from '@/components/agents/agent-tools';
import { AgentSkills } from '@/components/agents/agent-skills';
import { AgentFlowPanel } from '@/components/agents/agent-flow-panel';
import { AgentSuggestions } from '@/components/agents/agent-suggestions';
import { AgentEval } from '@/components/agents/agent-eval';
import { AgentOverview } from '@/components/agents/agent-overview';
import { AgentIdentity } from '@/components/agents/agent-identity';
import { AgentRuntime } from '@/components/agents/agent-runtime';
import { AgentSecurity } from '@/components/agents/agent-security';
import { AgentMemory } from '@/components/agents/agent-memory';
import { AiKnowledgeCard } from '@/components/settings/ai-knowledge';
import { useAgentConfig } from '@/components/agents/use-agent-config';
import { AgentBuilderShell, type Section } from '@/components/agents/agent-builder-shell';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

export default function AgentsPage() {
  const { accountId, accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [section, setSection] = useState<Section>('overview');
  const [decided, setDecided] = useState(false);
  const agentConfig = useAgentConfig();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setSection(data?.configured ? 'overview' : 'identity');
      } catch {
        if (!cancelled) setSection('identity');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Agentes de IA
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure o agente, defina o conhecimento e as ferramentas permitidas, e teste as respostas antes de o utilizar na caixa de entrada.
      </p>

      {decided && (
        <AgentBuilderShell
          active={section}
          onNavigate={setSection}
          agentName={agentConfig.agentName}
          agentRole={agentConfig.agentRole}
          isActive={agentConfig.isActive}
          canViewUsage={canViewUsage}
        >
          <div hidden={section !== 'overview'}>
            <AgentOverview state={agentConfig} onNavigate={setSection} />
          </div>

          <div hidden={section !== 'identity'}>
            <AgentIdentity state={agentConfig} />
          </div>

          <div hidden={section !== 'skills'}>
            <AgentSkills />
          </div>

          <div hidden={section !== 'tools'}>
            <AgentTools />
          </div>

          <div hidden={section !== 'knowledge'}>
            <AiKnowledgeCard
              accountId={accountId}
              canEdit={agentConfig.canEdit}
              hasEmbeddingsKey={
                agentConfig.embeddingsKeyEdited
                  ? agentConfig.embeddingsKey.trim().length > 0
                  : agentConfig.hasStoredEmbeddingsKey
              }
            />
          </div>

          <div hidden={section !== 'memory'}>
            <AgentMemory />
          </div>

          <div hidden={section !== 'security'}>
            <AgentSecurity state={agentConfig} />
          </div>

          <div hidden={section !== 'runtime'}>
            <AgentRuntime state={agentConfig} />
          </div>

          <div hidden={section !== 'playground'}>
            <AiPlayground onGoToSetup={() => setSection('runtime')} />
          </div>

          <div hidden={section !== 'flow'}>
            <AgentFlowPanel onOpenTab={(next) => setSection(next)} />
          </div>

          <div hidden={section !== 'suggestions'}>
            <AgentSuggestions />
          </div>

          {canViewUsage && (
            <div hidden={section !== 'eval'}>
              <AgentEval />
            </div>
          )}

          {canViewUsage && (
            <div hidden={section !== 'usage'}>
              <AiUsageCard />
            </div>
          )}
        </AgentBuilderShell>
      )}
    </div>
  );
}
