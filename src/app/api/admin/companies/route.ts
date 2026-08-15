import { NextResponse } from "next/server";
import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function platformInviteRedirectUrl(request: Request): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const baseUrl = configuredSiteUrl || new URL(request.url).origin;
  return `${baseUrl.replace(/\/+$/, "")}/login`;
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = platformAdminClient();
    const [accountsResult, profilesResult, invitationsResult] = await Promise.all([
      admin.from("accounts").select("id, name, owner_user_id, created_at, suspended_at, suspended_reason").order("created_at", { ascending: false }),
      admin.from("profiles").select("user_id, account_id, full_name, email, account_role"),
      admin.from("platform_company_invitations").select("id, company_name, invited_email, created_at, expires_at").is("accepted_at", null).order("created_at", { ascending: false }),
    ]);

    const error = accountsResult.error ?? profilesResult.error ?? invitationsResult.error;
    if (error) throw error;

    const profiles = profilesResult.data ?? [];
    const companies = (accountsResult.data ?? []).map((account) => {
      const members = profiles.filter((profile) => profile.account_id === account.id);
      const owner = members.find((profile) => profile.user_id === account.owner_user_id);
      return {
        id: account.id,
        name: account.name,
        createdAt: account.created_at,
        memberCount: members.length,
        suspendedAt: account.suspended_at,
        suspendedReason: account.suspended_reason,
        owner: owner ? { name: owner.full_name, email: owner.email } : null,
      };
    });

    return NextResponse.json({ companies, invitations: invitationsResult.data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let invitationId: string | null = null;
  try {
    const ctx = await requirePlatformAdmin();
    const body = (await request.json()) as { companyName?: unknown; email?: unknown };
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!companyName || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Nombre de empresa y correo válido son obligatorios" }, { status: 400 });
    }

    const admin = platformAdminClient();
    const { data: invitation, error: insertError } = await admin
      .from("platform_company_invitations")
      .insert({ company_name: companyName, invited_email: email, invited_by: ctx.userId, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "Ya existe una invitación pendiente para este correo" }, { status: 409 });
      }
      throw insertError;
    }
    invitationId = invitation.id;

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: companyName },
      redirectTo: platformInviteRedirectUrl(request),
    });
    if (inviteError) {
      await admin.from("platform_company_invitations").delete().eq("id", invitationId);
      invitationId = null;
      const conflict = /already|registered|exists/i.test(inviteError.message);
      return NextResponse.json(
        { error: conflict ? "Este correo ya pertenece a un usuario" : "No se pudo enviar la invitación" },
        { status: conflict ? 409 : 502 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (invitationId) {
      await platformAdminClient().from("platform_company_invitations").delete().eq("id", invitationId);
    }
    return toErrorResponse(error);
  }
}
