"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, Building2, Loader2, RefreshCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ApprovalDecision,
  ApprovalTipo,
  PendingApproval,
} from "@/lib/eter/aisdr-live-client";
import {
  approvalTipoLabel,
  formatConfidence,
  formatLeadLabel,
  isTextReplyTipo,
  readBatchDetails,
  readEscalationDetails,
  readMeetingSlotDetails,
  readTextReplyDetails,
} from "@/lib/eter/aisdr-live-presentation";

// ============================================================
// "SDR ao vivo" — aprovações pendentes do AI SDR, com decisão sem sair
// do EterWA. Fala apenas com as rotas internas
// /api/eter-agent/aisdr-live/{pending,decision}, nunca directamente
// com o AI SDR: o segredo de autenticação do AI SDR nunca chega a
// este ficheiro nem ao browser.
//
// Actualização automática por polling (o AI SDR vive noutra base de
// dados, por isso não há Supabase realtime possível aqui).
// ============================================================

const POLL_INTERVAL_MS = 20_000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; approvals: PendingApproval[] };

interface ConfirmState {
  approval: PendingApproval;
  decision: ApprovalDecision;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // corpo não era JSON — cai para a mensagem genérica abaixo.
  }
  return `O pedido falhou (código ${res.status}).`;
}

export default function SdrAoVivoPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  // Evita pisar um erro/estado mais recente com a resposta atrasada de
  // um polling anterior, sem precisar de um AbortController por ciclo.
  const requestSeq = useRef(0);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const seq = ++requestSeq.current;
    if (!opts.silent) setState({ status: "loading" });
    try {
      const res = await fetch("/api/eter-agent/aisdr-live/pending?limit=20");
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setState({ status: "error", message: await readErrorMessage(res) });
        return;
      }
      const body = (await res.json()) as { approvals: PendingApproval[] };
      if (seq !== requestSeq.current) return;
      setState({ status: "ready", approvals: body.approvals ?? [] });
    } catch {
      if (seq !== requestSeq.current) return;
      setState({
        status: "error",
        message:
          "Não foi possível ligar ao EterWA para carregar as aprovações. Verifique a sua ligação e tente novamente.",
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Polling — actualização silenciosa (não mostra o ecrã de
  // carregamento) para não fazer a lista "piscar" a cada ciclo.
  useEffect(() => {
    const timer = setInterval(() => load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const requestDecision = useCallback((approval: PendingApproval, decision: ApprovalDecision) => {
    setConfirm({ approval, decision });
  }, []);

  const confirmDecision = useCallback(async () => {
    if (!confirm) return;
    const { approval, decision } = confirm;
    setDecidingId(approval.id);
    try {
      const res = await fetch("/api/eter-agent/aisdr-live/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approval.id, decision }),
      });
      if (!res.ok) {
        toast.error(await readErrorMessage(res));
        return;
      }
      toast.success(
        decision === "send"
          ? "Aprovação enviada ao AI SDR."
          : "Aprovação descartada.",
      );
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", approvals: prev.approvals.filter((a) => a.id !== approval.id) }
          : prev,
      );
    } catch {
      toast.error(
        "Não foi possível enviar a decisão ao EterWA. Verifique a sua ligação e tente novamente.",
      );
    } finally {
      setDecidingId(null);
      setConfirm(null);
    }
  }, [confirm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SDR ao vivo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aprovações pendentes do AI SDR, prontas a decidir sem sair do EterWA.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Actualizar
        </Button>
      </div>

      {state.status === "loading" && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 text-center">
          <p className="text-sm font-medium text-destructive">{state.message}</p>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCcw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      )}

      {state.status === "ready" && state.approvals.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Sem aprovações pendentes
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Esta lista actualiza-se sozinha assim que o AI SDR tiver algo à sua espera.
          </p>
        </div>
      )}

      {state.status === "ready" && state.approvals.length > 0 && (
        <ul className="space-y-3">
          {state.approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              deciding={decidingId === approval.id}
              onDecide={(decision) => requestDecision(approval, decision)}
            />
          ))}
        </ul>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {confirm?.decision === "send" ? "Aprovar esta acção?" : "Descartar esta acção?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.decision === "send"
                ? "O AI SDR vai enviar isto de imediato. Esta acção não pode ser desfeita."
                : "O AI SDR vai descartar esta proposta sem a enviar. Esta acção não pode ser desfeita."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover/50 border-border">
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={decidingId !== null}>
              Cancelar
            </Button>
            <Button
              variant={confirm?.decision === "discard" ? "destructive" : "default"}
              onClick={confirmDecision}
              disabled={decidingId !== null}
            >
              {decidingId !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : confirm?.decision === "send" ? (
                "Aprovar"
              ) : (
                "Descartar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalCard({
  approval,
  deciding,
  onDecide,
}: {
  approval: PendingApproval;
  deciding: boolean;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{approvalTipoLabel(approval.tipo)}</Badge>
            {approval.lead && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {formatLeadLabel(approval.lead)}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">{approval.resumo}</p>
        </div>
      </div>

      <div className="mt-3">
        <ApprovalDetails tipo={approval.tipo} detalhes={approval.detalhes} />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={deciding}
          onClick={() => onDecide("discard")}
        >
          Descartar
        </Button>
        <Button size="sm" disabled={deciding} onClick={() => onDecide("send")}>
          {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Aprovar
        </Button>
      </div>
    </li>
  );
}

function ApprovalDetails({
  tipo,
  detalhes,
}: {
  tipo: ApprovalTipo;
  detalhes: PendingApproval["detalhes"];
}) {
  if (isTextReplyTipo(tipo)) {
    const d = readTextReplyDetails(detalhes);
    const confidence = formatConfidence(d.confidence);
    return (
      <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
        {d.mensagemRecebida && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mensagem do lead
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{d.mensagemRecebida}</p>
          </div>
        )}
        {d.textoProposto && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Resposta que a Vera quer enviar
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{d.textoProposto}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge
            variant="outline"
            className={cn(
              confidence.tier === "alta" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
              confidence.tier === "media" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
              confidence.tier === "baixa" && "border-destructive/40 text-destructive",
            )}
          >
            {confidence.label}
          </Badge>
          {d.escalationReasons.length > 0 &&
            d.escalationReasons.map((reason, i) => (
              <Badge key={i} variant="secondary">
                {reason}
              </Badge>
            ))}
        </div>
      </div>
    );
  }

  if (tipo === "meeting_slot") {
    const d = readMeetingSlotDetails(detalhes);
    return (
      <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
        {d.mensagemRecebida && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mensagem do lead
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{d.mensagemRecebida}</p>
          </div>
        )}
        {d.textoProposto && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Resposta proposta
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{d.textoProposto}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
          {d.horarioEscolhido && <span>Horário: {d.horarioEscolhido}</span>}
          {d.email && <span>Email: {d.email}</span>}
        </div>
      </div>
    );
  }

  if (tipo === "escalation") {
    const d = readEscalationDetails(detalhes);
    return (
      <div className="space-y-2 rounded-lg bg-destructive/5 p-3 text-sm">
        {d.mensagemRecebida && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mensagem do lead
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{d.mensagemRecebida}</p>
          </div>
        )}
        {d.rawBrainOutput && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Saída do agente (motivo da escalada)
            </p>
            <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 text-xs text-foreground">
              {d.rawBrainOutput}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // invite_batch / whatsapp_batch
  const d = readBatchDetails(detalhes);
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {d.batchDate && <span>Data do lote: {d.batchDate}</span>}
        {d.totalConvites !== null && <span>Total de convites: {d.totalConvites}</span>}
        {d.totalEmpresas !== null && <span>Total de empresas: {d.totalEmpresas}</span>}
      </div>
      {d.empresas.length > 0 && (
        <ul className="mt-1 space-y-1">
          {d.empresas.map((empresa, i) => (
            <li key={i} className="flex items-center gap-2 text-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{empresa.nome}</span>
              {empresa.nicho && (
                <span className="text-xs text-muted-foreground">· {empresa.nicho}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
