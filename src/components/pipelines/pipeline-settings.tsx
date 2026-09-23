"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { useChannels } from "@/hooks/use-channels";
import {
  channelsUsingPipeline,
  channelsUsingStage,
} from "@/lib/cb-channels/display";
import type { Pipeline, PipelineStage } from "@/types";
import { CLASSES, sugerirClasse } from "@/lib/funil/degraus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Trash2,
  Plus,
  GripVertical,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
];

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations("Pipelines.settings");
  const tFunil = useTranslations("Pipelines.funil");
  // 975: o seletor de degrau do funil de eficiência, por etapa. Os rótulos
  // das classes são chave MONTADA (`degraus.${classe}`) — o portão estático
  // de i18n não as enxerga; `src/lib/funil/degraus.test.ts` cobra os dois
  // dicionários.
  const opcoesDeDegrau = [
    { value: "", label: tFunil("degraus.nenhum") },
    ...CLASSES.map((classe) => ({
      value: classe,
      label: tFunil(`degraus.${classe}` as Parameters<typeof tFunil>[0]),
    })),
  ];
  const supabase = createClient();
  // Uma busca por montagem, falha silenciosa → lista vazia. É fail-open
  // consciente: sem os canais o operador perde o AVISO, não a ação — travar
  // a exclusão porque um GET não respondeu seria pior que o risco que o
  // aviso evita.
  const { channels } = useChannels();

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<PipelineStage[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * ⚠️ O rascunho vem do BANCO, lido a cada abertura, e não das props
   * (23/09/2026). Semeado das etapas e do funil da página, ele se perdia a
   * cada recarga dela — a da volta ao app troca os dois por objetos novos —,
   * e logo depois de uma troca de funil, ou de salvar e reabrir, mostrava as
   * etapas de outro funil ou as de antes do salvamento, e salvar de novo
   * desfazia o que acabara de ser salvo. Cada abertura tem um número
   * (`aberturaRef`): a leitura, o salvamento, "Adicionar", a lixeira e
   * "Excluir funil" de uma abertura anterior não mexem na atual. E a leitura
   * espera as gravações do diálogo que ainda estiverem no ar
   * (`registrarGravacao`), senão leria o banco de antes delas.
   */
  const [situacao, setSituacao] = useState<"carregando" | "pronto" | "falhou">(
    "carregando",
  );
  const aberturaRef = useRef(0);
  const gravacaoRef = useRef<Promise<unknown> | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const abertura = ++aberturaRef.current;
    if (!open) return;
    setSituacao("carregando");
    setShowDeleteConfirm(false);
    (async () => {
      await gravacaoRef.current?.catch(() => undefined);
      const [funil, etapas] = await Promise.all([
        supabase.from("pipelines").select("name").eq("id", pipeline.id).maybeSingle(),
        supabase
          .from("pipeline_stages")
          .select("*")
          .eq("pipeline_id", pipeline.id)
          .order("position"),
      ]);
      if (aberturaRef.current !== abertura) return;
      if (funil.error || !funil.data || etapas.error) {
        setSituacao("falhou");
        return;
      }
      setName((funil.data as { name: string }).name);
      setLocalStages((etapas.data ?? []) as PipelineStage[]);
      setSituacao("pronto");
    })();
  }, [open, pipeline.id, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function registrarGravacao<T>(gravacao: Promise<T>): Promise<T> {
    const anteriores = gravacaoRef.current;
    gravacaoRef.current = Promise.allSettled([anteriores, gravacao]);
    return gravacao;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);

    // One upsert for all stages — batches N stage writes into a single
    // round-trip. Previous implementation did N sequential UPDATEs which
    // latency-scaled linearly with stage count.
    const stageRows = localStages.map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
      // 950: etapa marcada carimba ganho/perdido por gatilho no banco.
      resultado: s.resultado ?? null,
      // 975: o degrau do funil de eficiência — independente do resultado.
      degrau: s.degrau ?? null,
    }));

    const abertura = aberturaRef.current;
    const [renameRes, stagesRes] = await registrarGravacao(
      Promise.all([
        supabase
          .from("pipelines")
          .update({ name: name.trim() })
          .eq("id", pipeline.id),
        supabase.from("pipeline_stages").upsert(stageRows, { onConflict: "id" }),
      ]),
    );

    setSaving(false);

    if (renameRes.error || stagesRes.error) {
      toast.error(t("toastFailedSave"));
      return;
    }

    // Fechado e reaberto enquanto gravava: a abertura de agora é outra, e
    // fechá-la levaria o que foi digitado nela.
    if (aberturaRef.current === abertura) onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  function handleAddStage() {
    return registrarGravacao(adicionarEtapa());
  }

  async function adicionarEtapa() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const abertura = aberturaRef.current;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        pipeline_id: pipeline.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    if (aberturaRef.current !== abertura) return;
    // Pela atualização funcional: outra escrita pode ter mexido na lista
    // enquanto esta estava no ar (duas lixeiras seguidas, por exemplo).
    setLocalStages((atual) => [...atual, data as PipelineStage]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  function handleRemoveStage(stageId: string) {
    return registrarGravacao(removerEtapa(stageId));
  }

  async function removerEtapa(stageId: string) {
    const abertura = aberturaRef.current;
    // Esta etapa é a ENTRADA de alguma conexão? (migration 908)
    //
    // A guarda de baixo — contagem de negócios — não cobre este caso: a etapa
    // recém-configurada como entrada tem exatamente ZERO negócios, então o
    // caso perigoso é justamente o que passa. Apagá-la zeraria
    // `cb_channels.default_stage_id` (ON DELETE SET NULL) e o roteamento
    // passaria a despejar todo cliente novo na etapa de menor `position` —
    // que neste banco é "Contato Avulso", uma faixa de estacionamento.
    const entradaDe = channelsUsingStage(channels, stageId);
    if (entradaDe.length > 0) {
      toast.error(
        t("toastStageIsChannelEntry", {
          channels: entradaDe.map((c) => c.label).join(", "),
        }),
      );
      return;
    }
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    if (count && count > 0) {
      toast.error(t("toastMoveOrDeleteDeals"));
      return;
    }
    // 975: etapa MAPEADA no funil de eficiência com histórico na trilha. O
    // mapeamento é lido hoje sobre a história inteira; apagar a etapa apaga a
    // classe dos passos dela — a entrada no funil desliza para a próxima etapa
    // mapeada e negócio que só passou por ela some da coorte. Zero negócios
    // NA etapa (a guarda acima) não protege disso: é o caso comum de uma
    // etapa antiga. Tirar o degrau antes é a saída explícita (achado do Codex
    // no PR #119). Sem degrau, a história daquela etapa não contava mesmo.
    const etapa = localStages.find((s) => s.id === stageId);
    if (etapa?.degrau) {
      const { count: eventos, error: erroTrilha } = await supabase
        .from("cb_lead_events")
        .select("id", { count: "exact", head: true })
        .or(`to_stage_id.eq.${stageId},from_stage_id.eq.${stageId}`);
      if (erroTrilha || (eventos ?? 0) > 0) {
        toast.error(t("toastStageMappedWithHistory"));
        return;
      }
    }
    const { error } = await supabase
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    if (aberturaRef.current !== abertura) return;
    setLocalStages((atual) => atual.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    const abertura = aberturaRef.current;
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from("pipelines")
      .delete()
      .eq("id", pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDeletePipeline"));
      return;
    }
    if (aberturaRef.current === abertura) onOpenChange(false);
    onPipelinesChanged();
    toast.success(t("toastDeleted"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("managePipeline")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {t("deletePipeline")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("deletePipelineDesc")}
                </p>
                {/* Conexões que despejam clientes AQUI. Apagar o funil zera
                    `default_pipeline_id` (ON DELETE SET NULL) e elas param de
                    criar negócio sem avisar ninguém — o operador só descobre
                    dias depois, olhando um Kanban que não enche mais. */}
                {channelsUsingPipeline(channels, pipeline.id).length > 0 && (
                  <p className="mt-2 text-xs font-medium text-red-400">
                    {t("deletePipelineChannels", {
                      channels: channelsUsingPipeline(channels, pipeline.id)
                        .map((c) => c.label)
                        .join(", "),
                    })}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleDeletePipeline}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t("deleting") : t("deletePipelineBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipelineName")}</Label>
                {/* Durante a carga, o nome vindo da página diz QUAL funil é este;
                    somente-leitura, e não desabilitado, para o foco inicial do
                    diálogo continuar caindo aqui. */}
                <Input
                  value={situacao === "pronto" ? name : pipeline.name}
                  readOnly={situacao !== "pronto"}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                {situacao === "carregando" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {situacao === "falhou" && (
                  <p className="text-xs text-red-700 dark:text-red-300">{t("falhouAoCarregar")}</p>
                )}
                {situacao === "pronto" && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onResultadoChange={(v) => {
                            const updated = [...localStages];
                            // 975: a tela SUGERE o degrau a partir do resultado
                            // (ganho → contrato, perdido → perda), só quando a
                            // etapa ainda não tem degrau. O cálculo nunca deriva
                            // um do outro; o operador confirma ao salvar.
                            const sugestao = updated[index].degrau ? null : sugerirClasse(v);
                            updated[index] = {
                              ...updated[index],
                              resultado: v,
                              ...(sugestao ? { degrau: sugestao } : {}),
                            };
                            setLocalStages(updated);
                          }}
                          onDegrauChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], degrau: v };
                            setLocalStages(updated);
                          }}
                          opcoesDeDegrau={opcoesDeDegrau}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                )}

                {/* 975: funil com degrau em alguma etapa mas sem Lead —
                    configuração incompleta: o Desempenho não calcula nada. */}
                {situacao === "pronto" &&
                  localStages.some((s) => s.degrau) &&
                  !localStages.some((s) => s.degrau === "lead") && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t("semLead")}</span>
                    </p>
                  )}

                {/* Add new stage */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          newStageColor === color
                            ? "var(--foreground)"
                            : "transparent",
                      }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && situacao === "pronto") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={situacao !== "pronto" || !newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="w-full border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("createNewPipeline")}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto bg-red-600 text-white hover:bg-red-700"
              >
                {t("deletePipeline")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || situacao !== "pronto" || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onResultadoChange,
  onDegrauChange,
  opcoesDeDegrau,
  onRemove,
  colors,
  t,
}: {
  stage: PipelineStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onResultadoChange: (v: string | null) => void;
  onDegrauChange: (v: string | null) => void;
  opcoesDeDegrau: { value: string; label: string }[];
  onRemove: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ColorSwatch value={stage.color} onChange={onColorChange} colors={colors} t={t} />
      <Input
        value={stage.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border"
      />
      {/* 950: o RESULTADO da etapa. Entrar nela carimba o negócio como
          ganho/perdido — por gatilho no banco, em qualquer caminho de
          escrita. Sair para etapa neutra NÃO reabre (fluxo do jurídico). */}
      <select
        value={stage.resultado ?? ''}
        onChange={(e) => onResultadoChange(e.target.value || null)}
        aria-label={t('stageOutcome')}
        title={t('stageOutcomeHint')}
        className="h-7 shrink-0 rounded-md border border-border bg-card px-1 text-xs text-foreground"
      >
        <option value="">{t('outcomeNone')}</option>
        <option value="ganho">{t('outcomeWon')}</option>
        <option value="perdido">{t('outcomeLost')}</option>
      </select>
      {/* 975: a que DEGRAU do funil de eficiência a etapa corresponde
          (lead → mql → reuniao → proposta → contrato, ou perda). Várias
          etapas podem apontar para o mesmo degrau; sem degrau, a etapa não
          conta no Desempenho. Independente do resultado ao lado. */}
      <select
        value={stage.degrau ?? ''}
        onChange={(e) => onDegrauChange(e.target.value || null)}
        aria-label={t('stageDegrau')}
        title={t('stageDegrauHint')}
        className="h-7 shrink-0 rounded-md border border-border bg-card px-1 text-xs text-foreground"
      >
        {opcoesDeDegrau.map((opcao) => (
          <option key={opcao.value} value={opcao.value}>
            {opcao.label}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={t("changeColor")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor:
                    c === value ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
