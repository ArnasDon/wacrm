'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
  Menu,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type Section =
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

interface NavItem {
  id: Section;
  label: string;
  icon: typeof Bot;
  gated?: boolean;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ id: 'overview', label: 'Visão Geral', icon: LayoutDashboard }] },
  {
    label: 'Configurar',
    items: [
      { id: 'identity', label: 'Identidade & Comportamento', icon: UserRound },
      { id: 'skills', label: 'Skills', icon: Layers },
      { id: 'tools', label: 'Ferramentas', icon: Wrench },
      { id: 'knowledge', label: 'Conhecimento', icon: BookOpen },
      { id: 'memory', label: 'Memória', icon: BrainCog },
    ],
  },
  {
    label: 'Controlar',
    items: [
      { id: 'security', label: 'Segurança & Handoff', icon: ShieldCheck },
      { id: 'runtime', label: 'Modelo & Runtime', icon: Cpu },
    ],
  },
  { label: 'Testar', items: [{ id: 'playground', label: 'Playground', icon: Sparkles }] },
  {
    label: 'Observar',
    items: [
      { id: 'flow', label: 'Fluxo ao vivo', icon: Workflow },
      { id: 'suggestions', label: 'Lições', icon: GraduationCap },
      { id: 'eval', label: 'Avaliação', icon: FlaskConical, gated: true },
      { id: 'usage', label: 'Utilização', icon: BarChart3, gated: true },
    ],
  },
];

export function sectionLabel(id: Section): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item.label;
  }
  return '';
}

/**
 * Internal Agent Builder navigation: a grouped sidebar instead of the
 * flat 13-item horizontal tab bar it replaces. Modeled as navigation
 * (buttons + aria-current="page"), not an ARIA tablist — matches
 * src/components/layout/sidebar.tsx's own pattern for the primary app
 * nav, including the mobile drawer mechanics (translate-x, backdrop,
 * Escape, scroll lock) copied from that file rather than reinvented.
 * Callers keep every section's content mounted and pass only the
 * active one as `children` swapped by the caller — see agents/page.tsx.
 */
export function AgentBuilderShell({
  active,
  onNavigate,
  agentName,
  agentRole,
  isActive,
  canViewUsage,
  children,
}: {
  active: Section;
  onNavigate: (section: Section) => void;
  agentName: string;
  agentRole: string;
  isActive: boolean;
  canViewUsage: boolean;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [active]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKey);
    };
  }, [mobileOpen]);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.gated || canViewUsage),
  })).filter((group) => group.items.length > 0);

  const nav = (onSelect?: () => void) => (
    <nav aria-label="Secções do agente" className="flex-1 overflow-y-auto px-3 py-4">
      {visibleGroups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className={index > 0 ? 'mt-6' : undefined}>
          {group.label && (
            <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isCurrent = item.id === active;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={isCurrent ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(item.id);
                      onSelect?.();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                      isCurrent
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="mt-4 flex gap-6 xl:items-start">
      {/* Mobile: trigger + backdrop + slide-in drawer, same recipe as the primary app sidebar. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground xl:hidden"
      >
        <Menu className="h-4 w-4" /> Secções
      </button>

      <button
        type="button"
        aria-label="Fechar menu"
        onClick={() => setMobileOpen(false)}
        className={cn(
          'fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity xl:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-label="Secções do agente"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-full w-72 flex-col border-r border-border bg-card',
          'transition-transform duration-200 ease-out will-change-transform xl:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold text-foreground">Assistente</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {nav(() => setMobileOpen(false))}
      </aside>

      {/* Desktop: permanent sidebar from xl (1280px) up — the primary app
          sidebar (240px) plus this one (288px) need the extra room. */}
      <aside className="sticky top-4 hidden w-72 shrink-0 flex-col rounded-xl border border-border bg-card xl:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', isActive ? 'bg-primary' : 'bg-muted-foreground')}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {agentName || 'Agente sem nome'}
            </p>
            {agentRole && <p className="truncate text-xs text-muted-foreground">{agentRole}</p>}
          </div>
        </div>
        {nav()}
      </aside>

      <div className="min-w-0 flex-1">
        <h2 className="mb-4 text-lg font-semibold text-foreground xl:mt-1">
          {sectionLabel(active)}
        </h2>
        {children}
      </div>
    </div>
  );
}
