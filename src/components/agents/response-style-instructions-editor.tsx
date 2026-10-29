'use client';

import { useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  X,
  Pencil,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Compass,
  Target,
  MessageSquare,
  Users,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface InstructionCategory {
  id: string;
  name: string;
  shortName: string;
  icon: typeof Compass;
  prefix: string;
  keywords: string[];
}

export const INSTRUCTION_CATEGORIES: InstructionCategory[] = [
  {
    id: 'conducao',
    name: 'Condução da conversa',
    shortName: 'Condução',
    icon: Compass,
    prefix: '[Condução]',
    keywords: [
      'conduz', 'conduza', 'condução', 'pergunta', 'pergunte', 'perguntar', 'passo', 'avanço',
      'avançar', 'direciona', 'direcionar', 'sequência', 'fluxo', 'conversa', 'diálogo',
      'próximo passo', 'terminar com', 'termine com', 'finalizar com', 'intercal', 'ritmo'
    ],
  },
  {
    id: 'qualificacao',
    name: 'Qualificação do cliente',
    shortName: 'Qualificação',
    icon: Target,
    prefix: '[Qualificação]',
    keywords: [
      'qualifica', 'qualificação', 'qualifique', 'qualificar', 'necessidade', 'orçamento',
      'decisão', 'perfil', 'interrogatório', 'investir', 'investimento', 'procura', 'procurando',
      'faixa de valor', 'tipo de imóvel', 'planta', 'moradia', 'interesse'
    ],
  },
  {
    id: 'comunicacao',
    name: 'Estilo de comunicação',
    shortName: 'Comunicação',
    icon: MessageSquare,
    prefix: '[Comunicação]',
    keywords: [
      'sucint', 'sucinta', 'sucinto', 'curt', 'curta', 'curto', 'cordial', 'cordialidade',
      'tom', 'humana', 'humano', 'frase', 'frases', 'linha', 'linhas', 'formal', 'informal',
      'acolhedor', 'acolher', 'linguagem', 'emoji', 'educad', 'caloroso', 'empátic'
    ],
  },
  {
    id: 'encaminhamento',
    name: 'Encaminhamento para a equipe',
    shortName: 'Encaminhamento',
    icon: Users,
    prefix: '[Encaminhamento]',
    keywords: [
      'equipe', 'humano', 'direcionar para a equipe', 'transfer', 'transferir', 'atendimento humano',
      'especialista', 'corretor', 'corretores', 'visita', 'agendar visita', 'passar o contato',
      'encaminhar', 'encaminhamento', 'conectar com'
    ],
  },
];

/**
 * Analyses text in real-time and returns the most suitable category based on keyword scoring.
 */
export function inferCategoryFromText(text: string): InstructionCategory {
  const lower = text.toLowerCase().trim();
  if (!lower) return INSTRUCTION_CATEGORIES[0];

  // First check explicit prefix tag
  const byPrefix = INSTRUCTION_CATEGORIES.find((c) => text.startsWith(c.prefix));
  if (byPrefix) return byPrefix;

  // Score each category based on keyword occurrences
  let bestCategory = INSTRUCTION_CATEGORIES[0];
  let maxScore = 0;

  for (const cat of INSTRUCTION_CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) {
        // Multi-word keywords get higher weight
        score += kw.includes(' ') ? 3 : 1;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}

export interface ResponseStyleInstructionsEditorProps {
  instructions: string[];
  loading?: boolean;
  onAdd: (text: string) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
  onEdit: (index: number, text: string) => Promise<void>;
  mode?: 'global' | 'property_exceptions';
  propertyName?: string;
  placeholder?: string;
  emptyLabel?: string;
  emptySublabel?: string;
  className?: string;
  searchThreshold?: number;
  showCentralPrinciple?: boolean;
}

export function ResponseStyleInstructionsEditor({
  instructions,
  loading = false,
  onAdd,
  onRemove,
  onEdit,
  mode = 'global',
  propertyName,
  placeholder,
  emptyLabel,
  emptySublabel,
  className,
  searchThreshold = 8,
  showCentralPrinciple = true,
}: ResponseStyleInstructionsEditorProps) {
  const isExceptionsMode = mode === 'property_exceptions';

  const defaultPlaceholder = isExceptionsMode
    ? (propertyName
        ? `Ex.: No empreendimento ${propertyName}, destaque os diferenciais de lazer com mais detalhes.`
        : 'Ex.: Neste empreendimento, explique os diferenciais de lazer com mais detalhes.')
    : 'Ex.: Responda com cordialidade e naturalidade, desenvolvendo só o necessário para atender ao pedido.';

  const defaultEmptyLabel = isExceptionsMode
    ? 'Nenhuma exceção de comportamento configurada.'
    : 'Nenhuma instrução salva ainda.';

  const defaultEmptySublabel = isExceptionsMode
    ? 'O comportamento global continua sendo aplicado normalmente.'
    : undefined;

  const effectivePlaceholder = placeholder ?? defaultPlaceholder;
  const effectiveEmptyLabel = emptyLabel ?? defaultEmptyLabel;
  const effectiveEmptySublabel = emptySublabel ?? defaultEmptySublabel;

  const [draft, setDraft] = useState('');
  // 'auto' means dynamically calculate from text; otherwise string category ID (manual override)
  const [selectedCategory, setSelectedCategory] = useState<string>('auto');
  const [adding, setAdding] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Resolved active category (either manual override or auto-inferred from text)
  const detectedCategory = useMemo(() => {
    if (selectedCategory !== 'auto') {
      return INSTRUCTION_CATEGORIES.find((c) => c.id === selectedCategory) || INSTRUCTION_CATEGORIES[0];
    }
    return inferCategoryFromText(draft);
  }, [selectedCategory, draft]);

  const handleAdd = async () => {
    const trimmed = draft.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const cat = detectedCategory;
      // If the text already has a bracket tag or prefix, keep it; otherwise prepend resolved category prefix
      const hasPrefix = INSTRUCTION_CATEGORIES.some((c) => trimmed.startsWith(c.prefix));
      const formatted = hasPrefix || !cat ? trimmed : `${cat.prefix} ${trimmed}`;

      await onAdd(formatted);
      setDraft('');
      // Open the target group automatically so the user sees their new item
      if (cat) {
        setOpenGroups((prev) => new Set(prev).add(cat.id));
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (index: number) => {
    if (removingIndex !== null) return;
    setRemovingIndex(index);
    try {
      await onRemove(index);
    } finally {
      setRemovingIndex(null);
    }
  };

  const startEdit = (index: number) => {
    if (editingIndex !== null) return;
    setEditingIndex(index);
    setEditDraft(instructions[index]);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft('');
  };

  const saveEdit = async (index: number) => {
    const trimmed = editDraft.trim();
    if (!trimmed || savingEdit) return;
    setSavingEdit(true);
    try {
      await onEdit(index, trimmed);
      setEditingIndex(null);
      setEditDraft('');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleExpanded = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // Group instructions by category
  const categorizedInstructions = useMemo(() => {
    const q = search.trim().toLowerCase();

    // Map each item in instructions to its resolved category & clean display text
    const categorized = instructions.map((rawText, originalIndex) => {
      let matchedCategory = INSTRUCTION_CATEGORIES.find((c) => rawText.startsWith(c.prefix));
      let cleanText = rawText;

      if (matchedCategory) {
        cleanText = rawText.slice(matchedCategory.prefix.length).trim();
      } else {
        // Fallback: match by keywords
        const lower = rawText.toLowerCase();
        matchedCategory =
          INSTRUCTION_CATEGORIES.find((c) => c.keywords.some((k) => lower.includes(k))) || undefined;
      }

      return {
        originalIndex,
        rawText,
        cleanText,
        categoryId: matchedCategory ? matchedCategory.id : 'outras',
        matchesSearch: !q || rawText.toLowerCase().includes(q),
      };
    });

    const groups: {
      category: InstructionCategory | { id: string; name: string; icon: typeof Layers; prefix: string };
      items: typeof categorized;
    }[] = INSTRUCTION_CATEGORIES.map((cat) => ({
      category: cat,
      items: categorized.filter((item) => item.categoryId === cat.id && item.matchesSearch),
    }));

    // Group for uncategorized if any
    const uncategorizedItems = categorized.filter(
      (item) => item.categoryId === 'outras' && item.matchesSearch,
    );
    if (uncategorizedItems.length > 0) {
      groups.push({
        category: {
          id: 'outras',
          name: 'Outras diretrizes de estilo',
          icon: Layers,
          prefix: '',
        },
        items: uncategorizedItems,
      });
    }

    return groups;
  }, [instructions, search]);

  const totalVisibleItems = useMemo(
    () => categorizedInstructions.reduce((sum, g) => sum + g.items.length, 0),
    [categorizedInstructions],
  );

  return (
    <div className={cn('space-y-3.5', className)}>
      {/* 1. Central Guiding Principle */}
      {showCentralPrinciple && (
        <div
          className={cn(
            'rounded-xl p-3.5 shadow-xs transition-colors',
            isExceptionsMode
              ? 'border border-border/80 bg-muted/30'
              : 'border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent',
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              {isExceptionsMode ? 'Princípio Central das Exceções' : 'Princípio Central de Atendimento'}
            </p>
          </div>
          <p className="mt-1.5 text-xs font-medium text-muted-foreground leading-relaxed pl-8">
            {isExceptionsMode
              ? '“Exceções só alteram o comportamento global onde houver conflito. Todas as demais regras globais continuam válidas.”'
              : '“A Clara acolhe, responde, entende, qualifica e conduz o cliente até a equipe.”'}
          </p>
        </div>
      )}

      {/* 2. Add New Form */}
      <div className="rounded-xl border border-border/70 bg-card p-3 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-foreground">
              {isExceptionsMode ? 'Nova Exceção de Comportamento' : 'Nova Instrução de Estilo'}
            </span>
            {draft.trim().length > 0 && selectedCategory === 'auto' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full animate-in fade-in-0 duration-200">
                <Sparkles className="h-3 w-3" />
                Enquadramento: <strong>{detectedCategory.shortName}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('auto')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                selectedCategory === 'auto'
                  ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              title="Detecta a categoria automaticamente pelo significado do texto digitado"
            >
              <Sparkles className="h-3 w-3" />
              <span>Auto</span>
            </button>
            {INSTRUCTION_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>{cat.shortName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {isExceptionsMode && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Use apenas quando este empreendimento precisar de um comportamento diferente do padrão global.
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleAdd();
              }
            }}
            disabled={loading}
            placeholder={effectivePlaceholder}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={adding || loading || !draft.trim()}
            className="h-9 text-xs shrink-0 gap-1.5"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Adicionar
          </Button>
        </div>
      </div>

      {/* 3. Search Bar */}
      {!loading && instructions.length > searchThreshold && (
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isExceptionsMode ? 'Buscar exceção por palavra-chave...' : 'Buscar instrução por palavra-chave...'}
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* 4. Categorized Groups (Accordions) */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
          </div>
        ) : instructions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-5 text-center space-y-1">
            <p className="text-xs font-semibold text-foreground">{effectiveEmptyLabel}</p>
            {effectiveEmptySublabel && (
              <p className="text-[11px] text-muted-foreground">{effectiveEmptySublabel}</p>
            )}
          </div>
        ) : totalVisibleItems === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {isExceptionsMode ? 'Nenhuma exceção corresponde à busca.' : 'Nenhuma instrução corresponde à busca.'}
          </p>
        ) : (
          categorizedInstructions.map(({ category, items }) => {
            const Icon = category.icon;
            const isOpen = openGroups.has(category.id) || search.trim().length > 0;
            const count = items.length;

            return (
              <div
                key={category.id}
                className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs transition-all"
              >
                {/* Group Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(category.id)}
                  className="flex w-full min-w-0 items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="truncate text-xs font-semibold text-foreground">
                      {category.name}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold">
                      {count}
                    </Badge>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Group Accordion Items */}
                {isOpen && (
                  <div className="border-t border-border/50 bg-background/50 p-2.5 space-y-1.5">
                    {items.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground italic">
                        {isExceptionsMode
                          ? `Nenhuma exceção neste grupo ainda. Adicione acima selecionando "${category.name}".`
                          : `Nenhuma instrução neste grupo ainda. Adicione acima selecionando "${category.name}".`}
                      </p>
                    ) : (
                      items.map((item) => {
                        const isEditing = editingIndex === item.originalIndex;
                        const isExpanded = expanded.has(item.originalIndex);

                        if (isEditing) {
                          return (
                            <div
                              key={item.originalIndex}
                              className="rounded-lg border border-primary/40 bg-card p-2.5 space-y-2 shadow-xs"
                            >
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                autoFocus
                                rows={3}
                                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground outline-none focus:border-primary/50"
                              />
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEdit}
                                  disabled={savingEdit}
                                  className="h-7 text-xs"
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void saveEdit(item.originalIndex)}
                                  disabled={savingEdit || !editDraft.trim()}
                                  className="h-7 text-xs"
                                >
                                  {savingEdit ? (
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="mr-1 h-3 w-3" />
                                  )}
                                  Salvar
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={item.originalIndex}
                            className="flex items-start gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-foreground shadow-2xs hover:border-border transition-colors"
                          >
                            <span
                              className={cn(
                                'flex-1 min-w-0 leading-relaxed whitespace-pre-wrap',
                                !isExpanded && 'line-clamp-2',
                              )}
                            >
                              {item.cleanText}
                            </span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(item.originalIndex)}
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                                title={isExpanded ? 'Recolher' : 'Expandir'}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(item.originalIndex)}
                                disabled={removingIndex !== null}
                                className="text-muted-foreground hover:text-primary disabled:opacity-40 cursor-pointer"
                                title={isExceptionsMode ? 'Editar exceção' : 'Editar instrução'}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemove(item.originalIndex)}
                                disabled={removingIndex !== null}
                                className="text-muted-foreground hover:text-destructive disabled:opacity-40 cursor-pointer"
                                title={isExceptionsMode ? 'Remover exceção' : 'Remover instrução'}
                              >
                                {removingIndex === item.originalIndex ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <X className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
