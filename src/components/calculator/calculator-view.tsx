'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { formatBRL } from '@/lib/calculator/money';
import { createClient } from '@/lib/supabase/client';
import {
  createCalcProject,
  listCalcProjects,
  updateCalcProject,
  type CalcProjectWithComponents,
} from '@/lib/calculator/queries';
import {
  applyDirectEdit,
  applyLockToggle,
  applyPercentEdit,
  createDefaultFlowItems,
  createFlowItem,
  recalculate,
  buildFlowText,
  toComponentTemplates,
} from '@/lib/calculator/engine';
import type { FlowItem } from '@/lib/calculator/types';
import { ProjectPicker } from './project-picker';
import { ProjectManagerDialog } from './project-manager-dialog';
import { PropertyValueInput } from './property-value-input';
import { FlowEditor } from './flow-editor';
import { FlowStatusBanner } from './flow-status-banner';
import { FlowSummary } from './flow-summary';

export function CalculatorView() {
  const t = useTranslations('Calculadora');
  const { accountId, user } = useAuth();

  const [mode, setMode] = useState<'free' | 'project'>('free');
  const [projects, setProjects] = useState<CalcProjectWithComponents[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [savingAsProject, setSavingAsProject] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);

  const [unit, setUnit] = useState('');
  // Identifies a Fluxo Livre simulation and doubles as the name used
  // when it's saved as an empreendimento — spec: "será utilizado para
  // identificar o fluxo e também como nome do empreendimento". Only
  // meaningful in mode === 'free'; a selected project has its own name.
  const [freeFlowName, setFreeFlowName] = useState('');
  const [propertyValue, setPropertyValue] = useState(0);
  const [items, setItems] = useState<FlowItem[]>(() => createDefaultFlowItems());
  // Which item (if any) the LAST edit explicitly designated as the
  // balancer — undefined means "not decided yet, let recalculate's own
  // auto-search figure it out" (fresh load: a brand-new Fluxo Livre or
  // a just-opened empreendimento, neither of which has been through an
  // edit yet). Every handler that resolves a FlowResult (applyItems,
  // applyDirectEdit, applyLockToggle) captures ITS OWN balancerId here
  // too, so the display below never re-derives a DIFFERENT one from
  // scratch — see the `result` memo's comment for why that mattered.
  const [balancerId, setBalancerId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = createClient();
        const list = await listCalcProjects(db);
        if (!cancelled) setProjects(list);
      } catch {
        // Templates are a convenience, not a hard dependency — Fluxo
        // Livre stays fully usable even if this fetch fails.
      } finally {
        if (!cancelled) setProjectsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const handleSelectProject = useCallback(
    (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      setSelectedProjectId(id);
      // Always reloads straight from the saved template — any
      // unsaved tweaks from a previous session with this same
      // project are intentionally discarded (spec §7: "se eu sair/
      // fechar sem salvar... deve voltar aos percentuais originais").
      setItems(project.components.map(createFlowItem));
      setBalancerId(undefined);
    },
    [projects],
  );

  const handleModeChange = useCallback((next: 'free' | 'project') => {
    setMode(next);
    if (next === 'free') {
      setSelectedProjectId(null);
      // Every new Fluxo Livre session starts from the four standard
      // etapas (10/25/25/40) — spec §2 and §4 — and a blank name, so a
      // name typed in a previous session never leaks into a fresh one.
      setItems(createDefaultFlowItems());
      setBalancerId(undefined);
      setFreeFlowName('');
    }
  }, []);

  // Recomputed on every propertyValue change so percent-driven items
  // keep rescaling live ("typing a new Valor do imóvel instantly
  // updates every etapa") — but `balancerId` is passed through
  // EXPLICITLY rather than left for recalculate's own auto-search.
  // Without this, any item whose percent link was ever broken (a
  // direct value edit always nulls the EDITED item's own percent —
  // see applyDirectEdit) would get silently re-flagged as "the
  // balancer" here on every subsequent render, turning its own field
  // read-only right after the user typed into it — regardless of
  // whether it was actually the field this update needed to auto-fill.
  const result = useMemo(
    () =>
      recalculate(
        propertyValue,
        items,
        balancerId === undefined ? undefined : { balancerId: balancerId ?? '__none__' },
      ),
    [propertyValue, items, balancerId],
  );

  // Pure display math (spec §7: "sempre que possível, apresentar também
  // a diferença em reais" — here in the other direction, the % gap
  // alongside the R$ one already produced by the engine's own
  // difference). Doesn't feed back into recalculate() at all.
  const percentGapAbs = useMemo(
    () => (propertyValue > 0 ? (Math.abs(result.difference) / propertyValue) * 100 : 0),
    [result.difference, propertyValue],
  );

  const applyItems = useCallback(
    (next: FlowItem[]) => {
      const res = recalculate(propertyValue, next);
      setItems(res.items);
      setBalancerId(res.balancerId);
    },
    [propertyValue],
  );

  const handleChangePropertyValue = useCallback((value: number) => {
    setPropertyValue(value);
  }, []);

  // Locking an item that leaves the flow off 100% (e.g. it was zeroed
  // first) proportionally redistributes the gap across the OTHER
  // unlocked items — see applyLockToggle's doc comment in engine.ts.
  // Unlocking is still a plain toggle + recalculate.
  const handleToggleLock = useCallback(
    (id: string) => {
      const res = applyLockToggle(propertyValue, items, id);
      setItems(res.items);
      setBalancerId(res.balancerId);
    },
    [items, propertyValue],
  );

  // Increasing/reducing one etapa's percent redistributes the
  // difference across every OTHER unlocked etapa, proportionally to
  // what each already held, so the flow always still closes at 100% —
  // "a calculadora não deve permitir fluxo excedente" (see engine.ts).
  const handleChangePercent = useCallback(
    (id: string, percent: number) => {
      const res = applyPercentEdit(propertyValue, items, id, percent);
      setItems(res.items);
      setBalancerId(res.balancerId);
    },
    [items, propertyValue],
  );

  // A direct edit to the per-unit VALUE is treated as "I know this
  // exact amount" — it breaks that item's percent link, and every
  // OTHER unlocked item shares whatever gap that leaves, proportionally
  // to what each already held — "aumentei as Chaves, e as Parcelas e
  // Intercaladas diminuíram proporcionalmente" (see engine.ts).
  const handleChangeValue = useCallback(
    (id: string, value: number) => {
      const res = applyDirectEdit(propertyValue, items, id, value);
      setItems(res.items);
      setBalancerId(res.balancerId);
    },
    [items, propertyValue],
  );

  // Quantity is a structural choice, not a value declaration — it
  // must NEVER touch any percent (this item's own, or any other
  // item's). Just update the count and let the normal percent-driven
  // path in recalculate() redistribute this item's own per-unit value
  // from its UNCHANGED percent. Routing this through applyDirectEdit
  // (like handleChangeValue does) was the root cause of quantity
  // edits silently zeroing out an unrelated item's percent (typically
  // Chaves, as the last unlocked item — see engine.ts's applyDirectEdit
  // doc comment for the full trace).
  const handleChangeCount = useCallback(
    (id: string, count: number) => {
      applyItems(items.map((i) => (i.id === id ? { ...i, count } : i)));
    },
    [items, applyItems],
  );

  const handleChangeLabel = useCallback((id: string, label: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)));
  }, []);

  const handleCopy = useCallback(async () => {
    const text = buildFlowText({
      projectName: mode === 'project' ? (selectedProject?.name ?? '') : freeFlowName,
      unit,
      items: result.items,
      total: result.total,
      formatMoney: formatBRL,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('flowCopied'));
    } catch {
      toast.error(t('copyError'));
    }
  }, [mode, selectedProject, freeFlowName, unit, result, t]);

  const handleSaveAsProject = useCallback(async () => {
    const trimmed = freeFlowName.trim();
    if (!trimmed) {
      toast.error(t('projectNameRequired'));
      return;
    }
    if (!accountId || !user?.id) return;
    setSavingAsProject(true);
    try {
      const db = createClient();
      const created = await createCalcProject(db, {
        accountId,
        userId: user.id,
        name: trimmed,
        components: toComponentTemplates(result.items, propertyValue),
      });
      setProjects((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(t('projectSaved'));
      setMode('project');
      setSelectedProjectId(created.id);
      setItems(created.components.map(createFlowItem));
      setBalancerId(undefined);
    } catch {
      toast.error(t('projectSaveError'));
    } finally {
      setSavingAsProject(false);
    }
  }, [freeFlowName, accountId, user, result, propertyValue, t]);

  const handleSaveProjectChanges = useCallback(async () => {
    if (!selectedProject) return;
    setSavingChanges(true);
    try {
      const db = createClient();
      const updated = await updateCalcProject(db, {
        id: selectedProject.id,
        name: selectedProject.name,
        components: toComponentTemplates(result.items, propertyValue),
      });
      setProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      toast.success(t('projectChangesSaved'));
    } catch {
      toast.error(t('projectSaveError'));
    } finally {
      setSavingChanges(false);
    }
  }, [selectedProject, result, propertyValue, t]);

  const resultTitle =
    mode === 'project' && selectedProject
      ? unit.trim()
        ? `${selectedProject.name.toUpperCase()} — ${t('unitLabel').toUpperCase()} ${unit.trim()}`
        : selectedProject.name.toUpperCase()
      : '';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-10">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ProjectPicker
        mode={mode}
        onModeChange={handleModeChange}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={handleSelectProject}
        onManageProjects={() => setManagerOpen(true)}
        freeFlowLabel={t('freeFlow')}
        projectsLabel={t('registeredProjects')}
        manageLabel={t('manageProjects')}
        noProjectsLabel={projectsLoaded ? t('noProjectsYet') : t('loadingProjects')}
      />

      {(mode === 'free' || selectedProject) && (
        <>
          {/* A single flat flex row (not nested grid-in-flex) — Tailwind's
              default stretch reliably equalizes sibling heights here,
              which is what keeps Valor do imóvel / Empreendimento /
              Unidade at identical heights regardless of label length. */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:flex-1">
              <PropertyValueInput
                label={t('propertyValue')}
                value={propertyValue}
                onChange={handleChangePropertyValue}
              />
            </div>
            {mode === 'free' && (
              <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-3 sm:w-48">
                <Label htmlFor="calc-free-flow-name" className="text-muted-foreground">
                  {t('empreendimentoLabel')}
                </Label>
                <Input
                  id="calc-free-flow-name"
                  value={freeFlowName}
                  onChange={(e) => setFreeFlowName(e.target.value)}
                  placeholder={t('projectNamePlaceholder')}
                />
              </div>
            )}
            <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-3 sm:w-40">
              <Label htmlFor="calc-unit" className="text-muted-foreground">
                {t('unit')}
              </Label>
              <Input
                id="calc-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={t('unitPlaceholder')}
              />
            </div>
          </div>

          <FlowStatusBanner
            status={result.status}
            differenceAbs={Math.abs(result.difference)}
            percentGapAbs={percentGapAbs}
            formatMoney={formatBRL}
            closedLabel={t('flowClosed')}
            incompleteLabel={t('flowIncomplete')}
            excessLabel={t('flowExcess')}
            missingPercentPrefix={t('missingPercentPrefix')}
            missingPercentSuffix={t('missingPercentSuffix')}
            missingAmountPrefix={t('missing')}
            excessOverPrefix={t('excessOverPrefix')}
            excessAmountPrefix={t('excessAmountPrefix')}
          />

          <FlowEditor
            items={result.items}
            balancerId={result.balancerId}
            propertyValue={propertyValue}
            formatMoney={formatBRL}
            onToggleLock={handleToggleLock}
            onChangeValue={handleChangeValue}
            onChangeCount={handleChangeCount}
            onChangePercent={handleChangePercent}
            onChangeLabel={handleChangeLabel}
            emptyStateLabel={t('emptyFlow')}
            installmentsCountLabel={t('installmentsCountLabel')}
            lockLabel={t('lock')}
            unlockLabel={t('unlock')}
            totalAmountLabel={t('totalAmountLabel')}
          />

          {mode === 'free' ? (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={handleSaveAsProject}
              disabled={savingAsProject}
            >
              {t('saveAsProject')}
            </Button>
          ) : (
            selectedProject && (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={handleSaveProjectChanges}
                disabled={savingChanges}
              >
                {t('saveProjectChanges')}
              </Button>
            )
          )}

          {result.items.length > 0 && (
            <FlowSummary
              title={resultTitle}
              propertyValueLabel={t('propertyValue')}
              totalLabel={t('flowTotal')}
              propertyValue={propertyValue}
              total={result.total}
              items={result.items}
              formatMoney={formatBRL}
              copyLabel={t('copyFlow')}
              onCopy={handleCopy}
              installmentsOfLabel={t('installmentsTimes')}
            />
          )}
        </>
      )}

      <ProjectManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        projects={projects}
        onProjectsChange={setProjects}
      />
    </div>
  );
}
