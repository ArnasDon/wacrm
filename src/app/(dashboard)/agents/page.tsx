'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  BookOpen,
  BrainCog,
  Cpu,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  Layers,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
  Wrench,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab =
  | 'overview'
  | 'identity'
  | 'skills'
  | 'tools'
  | 'knowledge'
  | 'memory'
  | 'security'
  | 'runtime'
  | 'playground'
  | 'flow'
  | 'suggestions'
  | 'eval'
  | 'usage';

export default function AgentsPage() {
  const { accountId, accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('overview');
  const [decided, setDecided] = useState(false);
  const agentConfig = useAgentConfig();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTab(data?.configured ? 'overview' : 'identity');
      } catch {
        if (!cancelled) setTab('identity');
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
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="mt-6"
        >
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">
              <LayoutDashboard className="mr-1.5 h-4 w-4" /> Visão Geral
            </TabsTrigger>
            <TabsTrigger value="identity">
              <UserRound className="mr-1.5 h-4 w-4" /> Identidade & Comportamento
            </TabsTrigger>
            <TabsTrigger value="skills">
              <Layers className="mr-1.5 h-4 w-4" /> Skills
            </TabsTrigger>
            <TabsTrigger value="tools">
              <Wrench className="mr-1.5 h-4 w-4" /> Ferramentas
            </TabsTrigger>
            <TabsTrigger value="knowledge">
              <BookOpen className="mr-1.5 h-4 w-4" /> Conhecimento
            </TabsTrigger>
            <TabsTrigger value="memory">
              <BrainCog className="mr-1.5 h-4 w-4" /> Memória
            </TabsTrigger>
            <TabsTrigger value="security">
              <ShieldCheck className="mr-1.5 h-4 w-4" /> Segurança & Handoff
            </TabsTrigger>
            <TabsTrigger value="runtime">
              <Cpu className="mr-1.5 h-4 w-4" /> Modelo & Runtime
            </TabsTrigger>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="flow">
              <Workflow className="mr-1.5 h-4 w-4" /> Fluxo ao vivo
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              <GraduationCap className="mr-1.5 h-4 w-4" /> Lições
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="eval">
                <FlaskConical className="mr-1.5 h-4 w-4" /> Avaliação
              </TabsTrigger>
            )}
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Utilização
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <AgentOverview
              state={agentConfig}
              onNavigate={(next) => setTab(next)}
            />
          </TabsContent>

          <TabsContent value="identity" className="mt-4">
            <AgentIdentity state={agentConfig} />
          </TabsContent>

          <TabsContent value="skills" className="mt-4">
            <AgentSkills />
          </TabsContent>

          <TabsContent value="tools" className="mt-4">
            <AgentTools />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-4">
            <AiKnowledgeCard
              accountId={accountId}
              canEdit={agentConfig.canEdit}
              hasEmbeddingsKey={
                agentConfig.embeddingsKeyEdited
                  ? agentConfig.embeddingsKey.trim().length > 0
                  : agentConfig.hasStoredEmbeddingsKey
              }
            />
          </TabsContent>

          <TabsContent value="memory" className="mt-4">
            <AgentMemory />
          </TabsContent>

          <TabsContent value="security" className="mt-4">
            <AgentSecurity state={agentConfig} />
          </TabsContent>

          <TabsContent value="runtime" className="mt-4">
            <AgentRuntime state={agentConfig} />
          </TabsContent>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('runtime')} />
          </TabsContent>

          <TabsContent value="flow" className="mt-4">
            <AgentFlowPanel onOpenTab={(nextTab) => setTab(nextTab)} />
          </TabsContent>

          <TabsContent value="suggestions" className="mt-4">
            <AgentSuggestions />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="eval" className="mt-4">
              <AgentEval />
            </TabsContent>
          )}

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
