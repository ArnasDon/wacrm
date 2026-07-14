import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  getNestedValue,
  evaluateConditions,
  resolveMapping,
  type WebhookCondition
} from '@/lib/generic-webhooks/utils';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { findExistingContact } from '@/lib/contacts/dedupe';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError
} from '@/lib/whatsapp/phone-utils';

interface WebhookWorkflow {
  id: string;
  account_id: string;
  integration_id: string;
  name: string;
  recipient_name_field: string;
  recipient_phone_field: string;
  recipient_email_field: string | null;
  conditions: {
    matchType?: 'all' | 'any';
    rules?: WebhookCondition[];
  } | null;
  actions: {
    type: string;
    template_name: string;
    language?: string;
    mappings?: {
      body?: import('@/lib/generic-webhooks/utils').WebhookMapping[];
      headerText?: import('@/lib/generic-webhooks/utils').WebhookMapping;
      headerMedia?: import('@/lib/generic-webhooks/utils').WebhookMapping;
      buttons?: Record<string, import('@/lib/generic-webhooks/utils').WebhookMapping>;
    };
  }[] | null;
  is_active: boolean;
  create_contacts?: boolean;
}

interface WebhookIntegration {
  id: string;
  account_id: string;
  name: string;
  whatsapp_config_id: string | null;
  is_connected: boolean;
  last_payload: unknown;
}

interface Contact {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface Conversation {
  id: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await context.params;
  const db = supabaseAdmin();

  let payload: Record<string, unknown> | null = null;
  try {
    const rawBody = await request.text();
    if (rawBody) {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    }
  } catch (e) {
    console.error('[webhooks] failed to parse incoming body as JSON:', e);
    return NextResponse.json({ error: 'Payload must be valid JSON' }, { status: 400 });
  }

  let resolvedAccountId: string | null = null;

  try {
    // 1. Check if the ID belongs to a single workflow
    const { data: workflowRow } = await db
      .from('webhook_workflows')
      .select('*, integration:webhook_integrations(*)')
      .eq('id', workflowId)
      .maybeSingle();

    if (workflowRow) {
      resolvedAccountId = workflowRow.account_id;
      const integration = workflowRow.integration;
      
      // Update integration's last_payload
      if (payload && integration) {
        await db
          .from('webhook_integrations')
          .update({
            last_payload: payload,
            is_connected: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', integration.id);
      }

      if (!workflowRow.is_active) {
        return NextResponse.json({ status: 'skipped', message: 'Workflow is inactive' });
      }

      if (!payload || Object.keys(payload).length === 0) {
        return NextResponse.json({ status: 'connected', message: 'Empty test payload received successfully' });
      }

      const result = await executeWorkflow(workflowRow, integration, payload);
      return NextResponse.json(result);
    }

    // 2. If not a workflow ID, check if it's an integration ID
    const { data: integrationRow } = await db
      .from('webhook_integrations')
      .select('*')
      .eq('id', workflowId)
      .maybeSingle();

    if (integrationRow) {
      resolvedAccountId = integrationRow.account_id;
      if (payload) {
        await db
          .from('webhook_integrations')
          .update({
            last_payload: payload,
            is_connected: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', integrationRow.id);
      }

      if (!payload || Object.keys(payload).length === 0) {
        return NextResponse.json({ status: 'connected', message: 'Empty test payload received successfully' });
      }

      // Fetch all active workflows for this integration
      const { data: workflows, error: wfErr } = await db
        .from('webhook_workflows')
        .select('*')
        .eq('integration_id', integrationRow.id)
        .eq('is_active', true);

      if (wfErr) {
        throw new Error(`Failed to fetch workflows: ${wfErr.message}`);
      }

      if (!workflows || workflows.length === 0) {
        return NextResponse.json({ status: 'connected', message: 'No active workflows configured for this integration.' });
      }

      const results = [];
      for (const wf of workflows) {
        try {
          const res = await executeWorkflow(wf, integrationRow, payload);
          results.push({ workflow: wf.name, status: 'success', details: res });
        } catch (err) {
          results.push({ workflow: wf.name, status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    console.warn('[webhooks] workflow/integration not found for id:', workflowId);
    return NextResponse.json({ error: 'Workflow or Integration not found' }, { status: 404 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown execution error';
    console.error('[webhooks] incoming trigger failed:', errorMsg);

    // Attempt logging failure for single workflow if we can identify it
    if (resolvedAccountId) {
      try {
        await db.from('webhook_logs').insert({
          account_id: resolvedAccountId,
          workflow_name: 'Webhook Error',
          status: 'failed',
          error_message: errorMsg,
          payload: payload
        });
      } catch (logErr) {
        console.error('[webhooks] logging failure failed:', logErr);
      }
    }

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// Single workflow execution runner
async function executeWorkflow(workflow: WebhookWorkflow, integration: WebhookIntegration, payload: Record<string, unknown> | null) {
  const db = supabaseAdmin();
  let customerPhone = '';
  let customerName = '';

  try {
    // 1. Evaluate conditions
    const condObj = workflow.conditions || {};
    const conditions: WebhookCondition[] = Array.isArray(condObj.rules) ? condObj.rules : [];
    const matchType: 'all' | 'any' = condObj.matchType === 'any' ? 'any' : 'all';

    const conditionsMatch = evaluateConditions(payload, conditions, matchType);
    if (!conditionsMatch) {
      // Record a log with no_match status
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'no_match',
        payload: payload,
        error_message: 'Conditions did not match'
      });
      return { status: 'no_match', message: 'Conditions did not match' };
    }

    // 2. Resolve recipient phone and name
    const phonePath = workflow.recipient_phone_field;
    const rawPhone = getNestedValue(payload, phonePath);
    if (!rawPhone) {
      throw new Error(`Recipient phone path "${phonePath}" resolved to empty value.`);
    }

    let sanitizedPhone = sanitizePhoneForMeta(String(rawPhone));
    if (sanitizedPhone.length === 10) {
      sanitizedPhone = '91' + sanitizedPhone;
    }
    
    if (!isValidE164(sanitizedPhone)) {
      throw new Error(`Sanitized phone number "${sanitizedPhone}" is not valid E164 format.`);
    }
    customerPhone = sanitizedPhone;

    const namePath = workflow.recipient_name_field;
    const rawName = getNestedValue(payload, namePath);
    customerName = rawName ? String(rawName) : sanitizedPhone;

    const emailPath = workflow.recipient_email_field;
    let customerEmail: string | null = null;
    if (emailPath) {
      const rawEmail = getNestedValue(payload, emailPath);
      customerEmail = rawEmail ? String(rawEmail).trim() : null;
    }

    // 3. Resolve WhatsApp configuration
    const configId = integration.whatsapp_config_id;
    if (!configId) {
      throw new Error('No WhatsApp channel selected for integration.');
    }

    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('id', configId)
      .maybeSingle();

    if (configErr || !config) {
      throw new Error('WhatsApp configuration record not found.');
    }

    const accessToken = decrypt(config.access_token);

    // 4. Execute actions (e.g. Send template)
    const actions = workflow.actions || [];
    const templateAction = actions.find((act) => act.type === 'send_template');

    if (!templateAction) {
      throw new Error('No template action defined for this workflow.');
    }

    const templateName = templateAction.template_name;
    const language = templateAction.language || 'en_US';

    // Load template row
    const { data: templateRow } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', workflow.account_id)
      .eq('name', templateName)
      .eq('language', language)
      .maybeSingle();

    // Resolve template parameters from payload mapping
    const mappings = templateAction.mappings || {};
    
    // Meta requires non-empty strings for all parameter values. If a mapped field is missing/empty, fallback to a space ' '
    const bodyParams = Array.isArray(mappings.body)
      ? mappings.body.map((m) => {
          const val = resolveMapping(payload, m);
          return val ? val.trim() : ' ';
        })
      : [];
    
    const headerText = mappings.headerText
      ? resolveMapping(payload, mappings.headerText)?.trim() || ' '
      : undefined;

    const headerMediaUrl = mappings.headerMedia
      ? resolveMapping(payload, mappings.headerMedia)?.trim() || ' '
      : undefined;

    const buttonParams: Record<number, string> = {};
    if (mappings.buttons) {
      for (const idx in mappings.buttons) {
        const numIdx = parseInt(idx, 10);
        if (!isNaN(numIdx) && mappings.buttons[idx]) {
          buttonParams[numIdx] = resolveMapping(payload, mappings.buttons[idx])?.trim() || ' ';
        }
      }
    }

    const templateParams = {
      body: bodyParams,
      headerText,
      headerMediaUrl,
      buttonParams
    };

    const adminUserId = config.user_id;

    // 5. Resolve / create Contact & Conversation based on toggle
    let contact: Contact | null = null;
    let conversation: Conversation | null = null;
    const shouldCreateContacts = workflow.create_contacts !== false;

    if (shouldCreateContacts) {
      const contactOutcome = await findOrCreateContact(
        workflow.account_id,
        adminUserId,
        sanitizedPhone,
        customerName,
        customerEmail
      );
      if (contactOutcome && contactOutcome.contact) {
        contact = contactOutcome.contact;
        conversation = await findOrCreateConversation(
          workflow.account_id,
          adminUserId,
          contactOutcome.contact.id
        );
      }
    } else {
      // Look up existing contact only
      const existingContact = await findExistingContact(db, workflow.account_id, sanitizedPhone);
      if (existingContact) {
        contact = existingContact;
        const updateFields: Partial<Contact> & { updated_at?: string } = {};
        if (customerName && customerName !== existingContact.name) {
          updateFields.name = customerName;
        }
        if (customerEmail && customerEmail !== existingContact.email) {
          updateFields.email = customerEmail;
        }
        if (Object.keys(updateFields).length > 0) {
          updateFields.updated_at = new Date().toISOString();
          await db.from('contacts').update(updateFields).eq('id', existingContact.id);
          Object.assign(existingContact, updateFields);
        }
        conversation = await findOrCreateConversation(
          workflow.account_id,
          adminUserId,
          existingContact.id
        );
      }
    }

    // 6. Send via Meta API with variant retries
    let waMessageId = '';
    let workingPhone = sanitizedPhone;
    let lastError: unknown = null;
    const variants = phoneVariants(sanitizedPhone);

    const attempt = async (phone: string): Promise<string> => {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName,
        language,
        template: templateRow ?? undefined,
        messageParams: templateParams
      });
      return result.messageId;
    };

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(msg)) {
          throw err;
        }
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    // If a contact was created/found and conversation resolved, log in history
    if (contact && conversation) {
      if (workingPhone !== contact.phone) {
        await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id);
      }

      const { error: msgErr } = await db.from('messages').insert({
        conversation_id: conversation.id,
        sender_type: 'bot',
        content_type: 'template',
        template_name: templateName,
        message_id: waMessageId,
        status: 'sent'
      });
      if (msgErr) {
        console.error('[webhooks] db message insert failed:', msgErr.message);
      }

      await db
        .from('conversations')
        .update({
          last_message_text: `[template:${templateName}]`,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', conversation.id);
    }

    // 7. Create success log entry
    await db.from('webhook_logs').insert({
      account_id: workflow.account_id,
      integration_id: integration.id,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      customer_name: customerName,
      customer_phone: workingPhone,
      status: 'success',
      payload: payload
    });

    return { success: true, message_id: waMessageId };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[webhooks] executeWorkflow ${workflow.name} failed:`, errorMsg);
    
    // Log failure
    try {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        status: 'failed',
        error_message: errorMsg,
        payload: payload
      });
    } catch (logErr) {
      console.error('[webhooks] executeWorkflow failed to insert error log:', logErr);
    }
    
    throw error;
  }
}

// Local findOrCreateContact & findOrCreateConversation helpers mirrors webhook/route.ts
async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  email?: string | null
) {
  const db = supabaseAdmin();
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    const updateFields: Partial<Contact> & { updated_at?: string } = {};
    if (name && name !== existingContact.name) {
      updateFields.name = name;
    }
    if (email && email !== existingContact.email) {
      updateFields.email = email;
    }
    if (Object.keys(updateFields).length > 0) {
      updateFields.updated_at = new Date().toISOString();
      await db.from('contacts').update(updateFields).eq('id', existingContact.id);
      Object.assign(existingContact, updateFields);
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      email: email || null
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating webhook contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string
) {
  const db = supabaseAdmin();
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single();

  if (!findError && existing) {
    return existing;
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating webhook conversation:', createError);
    return null;
  }

  return newConv;
}
