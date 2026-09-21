"use client";

import { funisVisiveis } from "@/lib/perfis/escopo";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { escritaDoTituloManual } from "@/lib/deals/titulo-do-card";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { ValorInput } from "@/components/valor/valor-input";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { avisarDrenagemDeFunil } from "@/lib/automations/avisar-drenagem";
import { urlDoInbox } from "@/lib/inbox/url";
import { nomeDoContato } from "@/lib/contacts/identidade";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  /**
   * Contato pré-selecionado ao CRIAR (Fase 4: o painel do inbox cria o
   * negócio da conversa aberta). Só semente do formulário — o operador ainda
   * pode trocar. Com o contato posto, o efeito de `linkedConversation` acha a
   * conversa dele sozinho e o `conversation_id` é carimbado no nascimento,
   * como manda a 910.
   */
  defaultContactId?: string;
  onSaved: () => void;
  /**
   * O formulário foi aberto a partir do QUADRO de funis (lápis do card).
   * Liga o link "ver conversa" à jornada do funil: `de=funil` na URL (a
   * faixa "Voltar ao funil" do inbox) e o retorno de rolagem gravado por
   * `aoIrParaConversa`. O painel do inbox NÃO passa os dois — lá o link é
   * navegação interna do próprio inbox.
   */
  origemFunil?: boolean;
  aoIrParaConversa?: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  defaultContactId,
  onSaved,
  origemFunil,
  aoIrParaConversa,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, acesso } = useAuth();

  const [title, setTitle] = useState("");
  // Número, não texto: quem converte o que foi digitado é o `ValorInput`.
  const [value, setValue] = useState(0);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  // Funil ESCOLHIDO — o card transita entre funis, então isto é estado, não
  // mais a propriedade fixa do quadro aberto. `pipelineId` vira só o valor
  // inicial de quem cria a partir de um quadro.
  const [selectedPipelineId, setSelectedPipelineId] = useState(pipelineId);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [allStages, setAllStages] = useState<PipelineStage[]>([]);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(deal.value ?? 0);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setSelectedPipelineId(deal.pipeline_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setValue(0);
      setContactId(defaultContactId ?? "");
      setStageId(defaultStageId || stages[0]?.id || "");
      setSelectedPipelineId(pipelineId);
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, defaultContactId, stages, pipelineId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // Etapas de TODOS os funis, não só do quadro aberto: mover o card
      // exige oferecer as etapas do funil de destino.
      const [c, p, funis, etapas] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        // Recorte por perfil (Fase 4): o formulário só oferece funis do
        // escopo — sem isto, o advogado do trabalhista criaria negócio no
        // funil do bancário pelo select.
        supabase.from("pipelines").select("id, name").order("name"),
        supabase.from("pipeline_stages").select("*").order("position"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
      setPipelines(funisVisiveis(acesso, (funis.data ?? []) as { id: string; name: string }[]));
      setAllStages((etapas.data ?? []) as PipelineStage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, acesso]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    setSaving(true);

    // ⚠️ O TÍTULO NÃO ENTRA NO PAYLOAD (1007). Ele é digitado, e quem o
    // digita FIXA o card: `escritaDoTituloManual` devolve o texto e a marca
    // juntos, e nada quando o título não mudou — o formulário reenvia todo
    // campo em cada salvamento, e regravar o título velho de uma tela aberta
    // há minutos congelaria justamente o nome que o gatilho acabou de pôr.
    const agora = new Date().toISOString();
    const payload = {
      value,
      // A coluna é NOT NULL e continua sendo preenchida, mesmo sem seletor:
      // negócio novo nasce em real, que é a única moeda daqui.
      currency: DEFAULT_CURRENCY,
      contact_id: contactId,
      pipeline_id: selectedPipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update({ ...payload, ...escritaDoTituloManual(deal.title, title, agora) })
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      // `conversation_id` entra SÓ na criação, nunca no `payload` acima: o
      // ramo de edição usa o mesmo objeto no `.update()`, e incluí-lo ali
      // reescreveria o vínculo histórico toda vez que alguém salvasse uma
      // nota — apontando o card para a conversa mais recente do contato em
      // vez daquela de onde ele nasceu.
      const { error } = await supabase.from("deals").insert({
        ...payload,
        // Card criado à mão nasce com o título fixado: alguém o escreveu.
        ...escritaDoTituloManual(null, title, agora),
        user_id: user.id,
        account_id: accountId,
        status: "open",
        conversation_id: linkedConversation?.id ?? null,
      });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    // Cobre criar card e mover de etapa pelo formulário. O trigger da 933 já
    // decidiu se havia o que enfileirar — salvar só a anotação não gera
    // evento —, então avisar aqui sempre é barato e não dispara nada à toa.
    avisarDrenagemDeFunil();
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    // Ganhou / perdeu / reabriu → gatilho `deal_status_changed`.
    avisarDrenagemDeFunil();
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ `data-[side=right]:` obrigatório — ver o comentário longo em
          `contact-detail-view.tsx`. Sem o prefixo, o `sm:max-w-sm` do
          `sheet.tsx` vence e este painel abre com 384px em vez dos 512px
          pedidos aqui. Corrigido junto com o da ficha do contato porque são
          painéis irmãos: com um só arrumado, os dois passariam a ter larguras
          diferentes na mesma tela de Funis. */}
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground data-[side=right]:sm:max-w-lg p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoContato(c, '')}
                  </option>
                ))}
              </select>

              {/* O caminho de volta do card para o atendimento.
                  ⚠️ A conversa do CONTATO manda; o vínculo gravado
                  (`deals.conversation_id`, 910) é fallback — mesma regra do
                  `conversaDoCard` do quadro. Invertido, trocar o contato do
                  negócio deixava o link (e o card) abrindo a conversa do
                  contato ANTIGO com a cara do novo — achado da revisão do
                  PR #71. O fallback continua cobrindo o caso que a 910
                  existe para tolerar: contato apagado (contact_id NULL, a
                  busca por contato não acha nada, e só o vínculo gravado
                  alcança a conversa). */}
              {(linkedConversation?.id ?? deal?.conversation_id) && (
                <Link
                  href={urlDoInbox({
                    c: linkedConversation?.id ?? deal?.conversation_id,
                    de: origemFunil ? "funil" : null,
                  })}
                  onClick={aoIrParaConversa}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            {/* Sem seletor de moeda e sem ícone de cifrão: o valor é sempre
                em real, e o próprio campo já mostra o `R$`. */}
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("value")}</Label>
              <ValorInput
                valor={value}
                aoMudar={setValue}
                placeholder={t("value")}
                aria-label={t("value")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("expectedCloseDate")}</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {/* TRANSFERIR ENTRE FUNIS. Some com um funil só — ali não decide
                nada. Trocar o funil TEM de trocar a etapa junto: a FK composta
                (stage_id, pipeline_id) da 908 recusa o par órfão no banco, e
                sem isto o operador só descobriria ao salvar. */}
            {pipelines.length > 1 && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipeline")}</Label>
                <select
                  value={selectedPipelineId}
                  onChange={(e) => {
                    const novo = e.target.value;
                    setSelectedPipelineId(novo);
                    const primeira = allStages.find((s) => s.pipeline_id === novo);
                    setStageId(primeira?.id ?? "");
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {/* Etapas do funil ESCOLHIDO. Cai no `stages` do quadro
                    enquanto a busca não voltou, para o seletor nunca ficar
                    vazio ao abrir. */}
                {(allStages.length > 0
                  ? allStages.filter((s) => s.pipeline_id === selectedPipelineId)
                  : stages
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("status")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t("markAsWon")}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        {t("markAsLost")}
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    {t("reopenDeal")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
