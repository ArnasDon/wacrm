import { NextResponse } from 'next/server';
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { platformAdminClient } from '@/lib/platform/admin-client';
import { markAccountPaid } from '@/lib/admin/subscriptions';
import { isVerticalSlug, NAV_SECTION_KEYS } from '@/lib/verticals';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
      suspended?: unknown;
      reason?: unknown;
      mark_paid?: unknown;
      next_payment_due_at?: unknown;
      add_seats?: unknown;
      add_whatsapp_numbers?: unknown;
      subscription_amount?: unknown;
      subscription_currency?: unknown;
      set_vertical?: unknown;
      set_hidden_nav?: unknown;
    };

    if (body.mark_paid === true) {
      const result = await markAccountPaid(platformAdminClient(), id);
      return NextResponse.json({ company: result });
    }

    if ('add_seats' in body) {
      const delta = body.add_seats;
      if (
        typeof delta !== 'number' ||
        !Number.isInteger(delta) ||
        delta === 0
      ) {
        return NextResponse.json(
          { error: 'La cantidad de cupos a agregar es inválida' },
          { status: 400 }
        );
      }
      const admin = platformAdminClient();
      const { data: current, error: fetchError } = await admin
        .from('accounts')
        .select('seat_limit')
        .eq('id', id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!current)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );

      const nextSeatLimit = Math.max(1, current.seat_limit + delta);
      const { data, error } = await admin
        .from('accounts')
        .update({ seat_limit: nextSeatLimit })
        .eq('id', id)
        .select('id, seat_limit')
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ company: data });
    }

    if ('add_whatsapp_numbers' in body) {
      const delta = body.add_whatsapp_numbers;
      if (
        typeof delta !== 'number' ||
        !Number.isInteger(delta) ||
        delta === 0
      ) {
        return NextResponse.json(
          { error: 'La cantidad de números a agregar es inválida' },
          { status: 400 }
        );
      }
      const admin = platformAdminClient();
      const { data: current, error: fetchError } = await admin
        .from('accounts')
        .select('whatsapp_number_limit')
        .eq('id', id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!current)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );

      const nextNumberLimit = Math.max(
        1,
        current.whatsapp_number_limit + delta
      );
      const { data, error } = await admin
        .from('accounts')
        .update({ whatsapp_number_limit: nextNumberLimit })
        .eq('id', id)
        .select('id, whatsapp_number_limit')
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ company: data });
    }

    if ('next_payment_due_at' in body) {
      const raw = body.next_payment_due_at;
      // null clears the billing cycle. A string must parse to a real
      // instant — an unparseable value ("banana") stored as-is would
      // read back as `Invalid Date` in `findAccountsDueInDays`, whose
      // day-diff check then never matches, silently muting every payment
      // alert for this account. Normalise to ISO so what's stored is
      // always a canonical timestamp.
      let value: string | null;
      if (raw === null) {
        value = null;
      } else if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
        value = new Date(raw).toISOString();
      } else {
        return NextResponse.json(
          { error: 'Fecha de pago inválida' },
          { status: 400 }
        );
      }
      const { data, error } = await platformAdminClient()
        .from('accounts')
        .update({ next_payment_due_at: value })
        .eq('id', id)
        .select('id, next_payment_due_at')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );
      return NextResponse.json({ company: data });
    }

    if ('set_vertical' in body) {
      // Relabel only — does NOT seed. Use POST .../apply-vertical to seed.
      if (!isVerticalSlug(body.set_vertical)) {
        return NextResponse.json(
          { error: "El vertical debe ser 'generic' o 'hotel'" },
          { status: 400 }
        );
      }
      const { data, error } = await platformAdminClient()
        .from('accounts')
        .update({ industry_vertical: body.set_vertical })
        .eq('id', id)
        .select('id, industry_vertical')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );
      return NextResponse.json({ company: data });
    }

    if ('set_hidden_nav' in body) {
      // Per-company sidebar-section visibility (migration 107). The
      // array lists the section `labelKey`s to HIDE. `null` clears the
      // override so the company falls back to its vertical default.
      const raw = body.set_hidden_nav;
      let value: string[] | null;
      if (raw === null) {
        value = null;
      } else if (
        Array.isArray(raw) &&
        raw.every((k) => typeof k === 'string')
      ) {
        const allowed = new Set<string>(NAV_SECTION_KEYS);
        value = Array.from(
          new Set((raw as string[]).filter((k) => allowed.has(k)))
        );
      } else {
        return NextResponse.json(
          { error: 'La lista de secciones ocultas es inválida' },
          { status: 400 }
        );
      }
      const { data, error } = await platformAdminClient()
        .from('accounts')
        .update({ hidden_nav_keys: value })
        .eq('id', id)
        .select('id, hidden_nav_keys')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );
      return NextResponse.json({ company: data });
    }

    if ('subscription_amount' in body || 'subscription_currency' in body) {
      const amount = body.subscription_amount;
      const currency = body.subscription_currency;
      if (
        (amount !== null &&
          (typeof amount !== 'number' ||
            !Number.isFinite(amount) ||
            amount < 0 ||
            amount > 9999999999.99)) ||
        typeof currency !== 'string' ||
        !/^[A-Z]{3}$/.test(currency)
      ) {
        return NextResponse.json(
          { error: 'Monto o moneda inválidos' },
          { status: 400 }
        );
      }
      const { data, error } = await platformAdminClient()
        .from('accounts')
        .update({
          subscription_amount: amount,
          subscription_currency: currency,
        })
        .eq('id', id)
        .select('id, subscription_amount, subscription_currency')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json(
          { error: 'Empresa no encontrada' },
          { status: 404 }
        );
      return NextResponse.json({ company: data });
    }

    if (typeof body.suspended !== 'boolean') {
      return NextResponse.json(
        { error: 'El estado de suspensión es obligatorio' },
        { status: 400 }
      );
    }

    if (id === ctx.accountId && body.suspended) {
      return NextResponse.json(
        {
          error:
            'No puedes suspender la empresa desde la que administras la plataforma',
        },
        { status: 409 }
      );
    }

    const reason =
      typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const { data, error } = await platformAdminClient()
      .from('accounts')
      .update({
        suspended_at: body.suspended ? new Date().toISOString() : null,
        suspended_reason: body.suspended
          ? reason || 'Suscripción pausada'
          : null,
      })
      .eq('id', id)
      .select('id, suspended_at, suspended_reason')
      .maybeSingle();

    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 }
      );
    return NextResponse.json({ company: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
