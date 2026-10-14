import { NextResponse } from 'next/server';
import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { withConnection } from '@/lib/db/transaction';
import { getPool } from '@/lib/db/pool';
import {
  readWhatsAppConfig,
  saveWhatsAppConfig,
  deleteWhatsAppConfig,
  phoneClaimedByAnotherAccount,
} from '@/lib/db/whatsapp-config';
import {
  assertSameOrigin,
  RequestError,
  localErrorResponse,
} from '@/lib/api/local-route';
import { hasMinRole } from '@/lib/auth/roles';
import {
  getSubscribedApps,
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain';
import {
  appSubscriptionState,
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from '@/lib/whatsapp/waba-pairing';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

/**
 * Shape every failed Meta call into `{ error, meta }` — the actionable
 * text plus the code / subcode / fbtrace_id / step a user can quote to
 * Meta support. Status is 400 when the fix is on the user's side (token,
 * ids, PIN) and 502 when Meta has to change something (issue #505).
 */
function metaFailure(
  err: unknown,
  step: MetaConnectStep,
  ctx: MetaErrorContext
) {
  const explained = explainMetaError(err, step, ctx);
  console.error(
    `[whatsapp/config] Meta ${step} failed:`,
    explained.metaMessage,
    {
      code: explained.code,
      subcode: explained.subcode,
      fbtrace_id: explained.fbtraceId,
    }
  );
  return NextResponse.json(
    { error: explained.summary, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus }
  );
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...},
 *     waba_subscription: { checked, subscribed, app_id_match, error? } }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...',
 *     meta: { code, subcode, fbtrace_id, step, field, message } }
 */
export async function GET() {
  try {
    const ctx = await getLocalAccountContext();
    const config = await withAccount(ctx, (db) =>
      readWhatsAppConfig(db, ctx.accountId)
    );

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message:
            'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      );
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err);
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      );
    }

    // Validate credentials against Meta
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      });
    } catch (err) {
      const explained = explainMetaError(err, 'verify_number', {
        phoneNumberId: config.phone_number_id,
        wabaId: config.waba_id,
      });
      console.error(
        '[whatsapp/config GET] Meta API verification failed:',
        explained.metaMessage
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: 200 }
      );
    }

    // Credentials work. Also report whether the WABA is subscribed to
    // this app — valid credentials with an unsubscribed WABA is exactly
    // the "connected but no messages arrive" state (issue #505). Never
    // fatal: the token may lack whatsapp_business_management and still
    // be fine for sending.
    let wabaSubscription: {
      checked: boolean;
      subscribed: boolean | null;
      app_id_match: boolean | null;
      error?: string;
    } = { checked: false, subscribed: null, app_id_match: null };
    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({
          wabaId: config.waba_id,
          accessToken,
        });
        const state = appSubscriptionState(subs, process.env.META_APP_ID);
        wabaSubscription = {
          checked: true,
          subscribed: state.subscribed,
          app_id_match: state.appIdMatch,
        };
      } catch (err) {
        const explained = explainMetaError(err, 'subscribed_apps', {
          wabaId: config.waba_id,
        });
        wabaSubscription = {
          checked: true,
          subscribed: null,
          app_id_match: null,
          error: explained.summary,
        };
      }
    }

    return NextResponse.json({
      connected: true,
      phone_info: phoneInfo,
      waba_subscription: wabaSubscription,
    });
  } catch (error) {
    return localErrorResponse(error);
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 *
 * Every Meta failure answers `{ error, meta: { code, subcode,
 * fbtrace_id, step, field, message } }` — `error` is the actionable
 * text, `meta` is what to quote to Meta support. 400 = fix it on the
 * form (token / ids / PIN), 502 = Meta has to change something.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'admin'))
      throw new RequestError('Insufficient permissions.', 403);
    const accountId = ctx.accountId;

    const body = await request.json();
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body;

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      );
    }

    // Meta ids are decimal digit strings. Catch the classic paste
    // mistakes (the +phone number, a display name, a URL) here with a
    // named field, instead of letting Meta answer "(#100) Unsupported
    // get request" for a value we could have rejected up front.
    if (!isNumericMetaId(phone_number_id)) {
      return NextResponse.json(
        {
          error:
            'Phone Number ID must contain only digits — it is the numeric id shown under Meta → WhatsApp → API Setup, not the phone number itself.',
          field: 'phone_number_id',
        },
        { status: 400 }
      );
    }
    if (
      waba_id !== undefined &&
      waba_id !== null &&
      waba_id !== '' &&
      !isNumericMetaId(waba_id)
    ) {
      return NextResponse.json(
        {
          error:
            'WhatsApp Business Account ID must contain only digits — copy it from Meta → WhatsApp → API Setup.',
          field: 'waba_id',
        },
        { status: 400 }
      );
    }
    const metaCtx: MetaErrorContext = {
      phoneNumberId: phone_number_id,
      wabaId: waba_id || null,
    };

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        );
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    const claimed = await withConnection(getPool('worker'), (db) =>
      phoneClaimedByAnotherAccount(db, accountId, phone_number_id)
    );

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      );
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      });
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx);
    }

    // The number resolves — now make sure it lives under the WABA the
    // user typed. A foreign-but-valid WABA ID used to save fine and
    // subscribe the *wrong* account, surfacing days later as a webhook
    // that never fires. Failing here names the mismatch instead.
    if (waba_id) {
      let wabaNumbers;
      try {
        wabaNumbers = await listWabaPhoneNumbers({
          wabaId: waba_id,
          accessToken: access_token,
        });
      } catch (err) {
        return metaFailure(err, 'waba_phone_numbers', metaCtx);
      }
      if (!phoneNumberBelongsToWaba(wabaNumbers, phone_number_id)) {
        return NextResponse.json(
          {
            error: describeWabaPhoneMismatch(
              wabaNumbers,
              phone_number_id,
              waba_id
            ),
            field: 'waba_id',
            meta: {
              code: null,
              subcode: null,
              fbtrace_id: null,
              step: 'waba_phone_numbers',
              field: 'waba_id',
              message: 'phone_number_id is not listed under waba_id',
            },
          },
          { status: 400 }
        );
      }
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown encryption error';
      console.error('Encryption failed:', message);
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      );
    }

    // Look up any pre-existing row for this account so we know whether
    // this number is already registered with Meta — if so we can skip
    // /register when the user didn't provide a PIN this time around.
    const existing = await withAccount(ctx, (db) =>
      readWhatsAppConfig(db, accountId)
    );

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null;

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null;
    let registrationError: string | null = null;
    let registrationMeta: ReturnType<typeof metaErrorPayload> | null = null;
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false;

    const needsRegistration =
      !sameNumber || (typeof pin === 'string' && pin.length > 0);
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true;
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          });
          registeredAt = new Date().toISOString();
        } catch (err) {
          const explained = explainMetaError(err, 'register', metaCtx);
          registrationError = explained.summary;
          registrationMeta = metaErrorPayload(explained);
          console.error(
            'Phone number /register failed:',
            explained.metaMessage,
            registrationMeta
          );
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    //
    // A failure here used to be swallowed with a console.warn, which
    // left the user with a green "connected" banner and a webhook that
    // never fired. Without this subscription Meta delivers nothing, so
    // treat it as a failed connect and say why (issue #505). Nothing
    // has been written yet, so the user just fixes the cause and saves
    // again.
    let subscribedAppsAt: string | null = null;
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        });
        subscribedAppsAt = new Date().toISOString();
      } catch (err) {
        return metaFailure(err, 'subscribe_waba', metaCtx);
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    };

    await withAccount(ctx, (db) => saveWhatsAppConfig(db, ctx.userId, baseRow));

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        error: registrationError,
        meta: registrationMeta,
        phone_info: phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
  } catch (error) {
    return localErrorResponse(error);
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'admin'))
      throw new RequestError('Insufficient permissions.', 403);
    await withAccount(ctx, (db) => deleteWhatsAppConfig(db, ctx.accountId));
    return NextResponse.json({ success: true });
  } catch (error) {
    return localErrorResponse(error);
  }
}
