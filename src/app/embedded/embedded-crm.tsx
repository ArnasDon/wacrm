"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { Deal, Pipeline, PipelineStage } from "@/types";

type ChatwootContext = {
  accountId: number;
  contactId: number;
  conversationId: number;
  contact: Record<string, unknown>;
};

function parseContext(value: unknown): ChatwootContext | null {
  if (typeof value !== "string") return null;

  try {
    const payload = JSON.parse(value) as {
      event?: string;
      data?: { conversation?: { id?: unknown; account_id?: unknown }; contact?: { id?: unknown } };
    };
    const conversation = payload.data?.conversation;
    const contact = payload.data?.contact;
    if (
      payload.event !== "appContext" ||
      typeof conversation?.id !== "number" ||
      typeof conversation.account_id !== "number" ||
      typeof contact?.id !== "number"
    ) return null;

    return {
      accountId: conversation.account_id,
      contactId: contact.id,
      conversationId: conversation.id,
      contact: contact as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function EmbeddedCrmContent() {
  const supabase = useMemo(() => createClient(), []);
  const { user, accountId, loading, profileLoading, canSendMessages } = useAuth();
  const [context, setContext] = useState<ChatwootContext | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeal = useCallback(async (nextContext: ChatwootContext) => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    const { data: link, error: linkError } = await supabase
      .from("chatwoot_deal_links")
      .select("deal_id")
      .eq("account_id", accountId)
      .eq("chatwoot_conversation_id", nextContext.conversationId)
      .maybeSingle();
    if (linkError) {
      setError("Não foi possível consultar o vínculo do CRM.");
      setBusy(false);
      return;
    }
    if (!link) {
      setDeal(null);
      setPipeline(null);
      setStage(null);
      setBusy(false);
      return;
    }
    const { data: nextDeal, error: dealError } = await supabase
      .from("deals")
      .select("*")
      .eq("id", link.deal_id)
      .maybeSingle();
    if (dealError || !nextDeal) {
      setError("O negócio vinculado não está disponível.");
      setBusy(false);
      return;
    }
    const [{ data: nextPipeline }, { data: nextStage }] = await Promise.all([
      supabase.from("pipelines").select("*").eq("id", nextDeal.pipeline_id).maybeSingle(),
      supabase.from("pipeline_stages").select("*").eq("id", nextDeal.stage_id).maybeSingle(),
    ]);
    setDeal(nextDeal as Deal);
    setPipeline((nextPipeline as Pipeline | null) ?? null);
    setStage((nextStage as PipelineStage | null) ?? null);
    setBusy(false);
  }, [accountId, supabase]);

  useEffect(() => {
    const origin = process.env.NEXT_PUBLIC_CHATWOOT_ORIGIN;
    if (!origin) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const nextContext = parseContext(event.data);
      if (!nextContext) return;
      setContext(nextContext);
    };
    window.addEventListener("message", handleMessage);
    window.parent.postMessage("chatwoot-dashboard-app:fetch-info", origin);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadDeal]);

  useEffect(() => {
    if (context && accountId) loadDeal(context);
  }, [accountId, context, loadDeal]);

  const createDeal = useCallback(async () => {
    if (!context || !user || !accountId || !canSendMessages) return;
    setBusy(true);
    setError(null);
    const { data: firstPipeline, error: pipelineError } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (pipelineError || !firstPipeline) {
      setError("Crie um pipeline no WACRM antes de vincular um negócio.");
      setBusy(false);
      return;
    }
    const { data: firstStage, error: stageError } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", firstPipeline.id)
      .order("position")
      .limit(1)
      .maybeSingle();
    if (stageError || !firstStage) {
      setError("O pipeline selecionado não possui etapas.");
      setBusy(false);
      return;
    }
    const contactName = typeof context.contact.name === "string" ? context.contact.name : "Contato do Chatwoot";
    const { data: nextDeal, error: dealError } = await supabase
      .from("deals")
      .insert({
        user_id: user.id,
        account_id: accountId,
        pipeline_id: firstPipeline.id,
        stage_id: firstStage.id,
        contact_id: null,
        title: contactName,
        value: 0,
        status: "open",
        notes: `Criado pela conversa ${context.conversationId} do Chatwoot.`,
      })
      .select()
      .single();
    if (dealError || !nextDeal) {
      setError("Não foi possível criar o negócio.");
      setBusy(false);
      return;
    }
    const { error: linkError } = await supabase.from("chatwoot_deal_links").insert({
      account_id: accountId,
      deal_id: nextDeal.id,
      chatwoot_account_id: context.accountId,
      chatwoot_contact_id: context.contactId,
      chatwoot_conversation_id: context.conversationId,
      contact_snapshot: context.contact,
    });
    if (linkError) {
      await supabase.from("deals").delete().eq("id", nextDeal.id);
      setError("Não foi possível vincular a conversa ao negócio.");
      setBusy(false);
      return;
    }
    await loadDeal(context);
  }, [accountId, canSendMessages, context, loadDeal, supabase, user]);

  if (loading || profileLoading) return <Loading />;
  if (!user) return <Message text="Entre no WACRM para usar o CRM integrado ao Chatwoot." />;
  if (!context) return <Message text="Aguardando o contexto da conversa do Chatwoot." />;
  if (busy) return <Loading />;
  if (error) return <Message text={error} />;
  if (!deal) return (
    <main className="p-4 text-sm">
      <p className="font-medium">Nenhum negócio vinculado a esta conversa.</p>
      <p className="mt-1 text-muted-foreground">Crie um card no primeiro pipeline configurado.</p>
      <Button className="mt-4" disabled={!canSendMessages} onClick={createDeal}>Criar negócio</Button>
    </main>
  );
  return (
    <main className="space-y-3 p-4 text-sm">
      <div><p className="text-muted-foreground">Negócio</p><p className="font-semibold">{deal.title}</p></div>
      <div><p className="text-muted-foreground">Pipeline</p><p>{pipeline?.name ?? "Indisponível"}</p></div>
      <div><p className="text-muted-foreground">Etapa atual</p><p className="font-medium">{stage?.name ?? "Indisponível"}</p></div>
      <a className="text-primary underline" href="/pipelines" target="_blank" rel="noreferrer">Abrir pipelines no WACRM</a>
    </main>
  );
}

function Loading() {
  return <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
}

function Message({ text }: { text: string }) {
  return <main className="p-4 text-sm text-muted-foreground">{text}</main>;
}

export function EmbeddedCrm() {
  return <AuthProvider><EmbeddedCrmContent /></AuthProvider>;
}
