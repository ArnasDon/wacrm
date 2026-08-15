"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Company {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  owner: { name: string | null; email: string } | null;
  usage30d: { messages: number; conversations: number; aiTokens: number };
}

interface Invitation {
  id: string;
  company_name: string;
  invited_email: string;
  created_at: string;
  expires_at: string;
}

export default function PlatformAdminPage() {
  const { isPlatformAdmin, profileLoading } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/companies", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar la plataforma");
      setCompanies(body.companies);
      setInvitations(body.invitations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la plataforma");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformAdmin) void load();
    else if (!profileLoading) setLoading(false);
  }, [isPlatformAdmin, profileLoading, load]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, email }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo crear la invitación");
      setCompanyName("");
      setEmail("");
      setOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la invitación");
    } finally {
      setSubmitting(false);
    }
  };

  const changeSuspension = async (company: Company) => {
    const suspending = !company.suspendedAt;
    const reason = suspending
      ? window.prompt("Motivo de la suspensión", "Falta de pago")
      : null;
    if (suspending && reason === null) return;
    if (!window.confirm(suspending ? `¿Suspender ${company.name}?` : `¿Reactivar ${company.name}?`)) return;

    setChangingId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: suspending, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo cambiar la suscripción");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la suscripción");
    } finally {
      setChangingId(null);
    }
  };

  if (!profileLoading && !isPlatformAdmin) {
    return <Card><CardHeader><CardTitle>Acceso restringido</CardTitle><CardDescription>Esta sección solo está disponible para el operador de Chat Sandía.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Building2 className="size-6 text-primary" />Plataforma</h1>
          <p className="mt-1 text-sm text-muted-foreground">Empresas afiliadas a Chat Sandía y sus invitaciones.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />Actualizar</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}><Plus />Nueva empresa</DialogTrigger>
            <DialogContent>
              <form onSubmit={invite}>
                <DialogHeader><DialogTitle>Nueva empresa afiliada</DialogTitle><DialogDescription>Crearemos una invitación para el dueño. Al aceptarla se generará una empresa aislada con todas las funciones.</DialogDescription></DialogHeader>
                <div className="my-5 space-y-4">
                  <div className="space-y-2"><Label htmlFor="companyName">Nombre de la empresa</Label><Input id="companyName" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required maxLength={120} /></div>
                  <div className="space-y-2"><Label htmlFor="ownerEmail">Correo del dueño</Label><Input id="ownerEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
                </div>
                <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={submitting}>{submitting ? "Enviando…" : "Enviar invitación"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <Card><CardHeader><CardTitle>Empresas</CardTitle><CardDescription>{companies.length} empresas registradas · consumo de los últimos 30 días</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Dueño</TableHead><TableHead>Usuarios</TableHead><TableHead>Conversaciones</TableHead><TableHead>Mensajes</TableHead><TableHead>Tokens IA</TableHead><TableHead>Estado</TableHead><TableHead>Alta</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{companies.map((company) => <TableRow key={company.id}><TableCell className="font-medium">{company.name}</TableCell><TableCell><div>{company.owner?.name || "Sin nombre"}</div><div className="text-xs text-muted-foreground">{company.owner?.email || "Sin correo"}</div></TableCell><TableCell>{company.memberCount}</TableCell><TableCell>{company.usage30d.conversations.toLocaleString("es-GT")}</TableCell><TableCell>{company.usage30d.messages.toLocaleString("es-GT")}</TableCell><TableCell>{company.usage30d.aiTokens.toLocaleString("es-GT")}</TableCell><TableCell><span className={company.suspendedAt ? "text-destructive" : "text-emerald-500"}>{company.suspendedAt ? "Suspendida" : "Activa"}</span>{company.suspendedReason ? <div className="max-w-48 truncate text-xs text-muted-foreground" title={company.suspendedReason}>{company.suspendedReason}</div> : null}</TableCell><TableCell>{new Date(company.createdAt).toLocaleDateString("es-GT")}</TableCell><TableCell className="text-right"><Button size="sm" variant={company.suspendedAt ? "outline" : "destructive"} disabled={changingId === company.id} onClick={() => void changeSuspension(company)}>{changingId === company.id ? "Guardando…" : company.suspendedAt ? "Reactivar" : "Suspender"}</Button></TableCell></TableRow>)}{!loading && companies.length === 0 ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No hay empresas registradas.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>

      <Card><CardHeader><CardTitle>Invitaciones pendientes</CardTitle><CardDescription>Vencen siete días después de enviarse.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Correo</TableHead><TableHead>Enviada</TableHead><TableHead>Vence</TableHead></TableRow></TableHeader><TableBody>{invitations.map((invitation) => <TableRow key={invitation.id}><TableCell className="font-medium">{invitation.company_name}</TableCell><TableCell>{invitation.invited_email}</TableCell><TableCell>{new Date(invitation.created_at).toLocaleDateString("es-GT")}</TableCell><TableCell>{new Date(invitation.expires_at).toLocaleDateString("es-GT")}</TableCell></TableRow>)}{!loading && invitations.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No hay invitaciones pendientes.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
    </div>
  );
}
