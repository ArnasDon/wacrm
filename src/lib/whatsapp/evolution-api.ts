/**
 * Evolution API helpers for WhatsApp.
 */

export interface EvolutionApiConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
}

export interface EvolutionSendResult {
  messageId: string;
}

export interface EvolutionPhoneInfo {
  id: string;
  display_phone_number: string;
  verified_name?: string;
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = await response.json();
    if (data.message) message = data.message;
    if (data.error) message = typeof data.error === 'string' ? data.error : data.error.message || message;
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message);
}

// ============================================================
// Instance Management
// ============================================================

export interface VerifyEvolutionInstanceArgs {
  config: EvolutionApiConfig;
}

export async function verifyEvolutionInstance({ config }: VerifyEvolutionInstanceArgs): Promise<EvolutionPhoneInfo> {
  const { apiUrl, apiKey, instanceName } = config;
  const url = `${apiUrl.replace(/\/$/, '')}/instance/connectionState/${instanceName}`;
  
  const response = await fetch(url, {
    headers: { 'apikey': apiKey },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Instance not found');
    }
    await throwEvolutionError(response, `Evolution API error: ${response.status}`);
  }

  const data = await response.json();
  
  return {
    id: data.instance?.instanceName || instanceName,
    display_phone_number: data.instance?.owner || data.instance?.profileName || 'Unknown',
    verified_name: data.instance?.profileName || 'Evolution Instance',
  };
}

export async function createEvolutionInstance({ config }: VerifyEvolutionInstanceArgs) {
  const { apiUrl, apiKey, instanceName } = config;
  const url = `${apiUrl.replace(/\/$/, '')}/instance/create`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
    },
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  });

  if (!response.ok) {
    await throwEvolutionError(response, `Failed to create instance: ${response.status}`);
  }

  return response.json();
}

export async function getEvolutionInstanceQR({ config }: VerifyEvolutionInstanceArgs) {
  const { apiUrl, apiKey, instanceName } = config;
  const url = `${apiUrl.replace(/\/$/, '')}/instance/connect/${instanceName}`;
  
  const response = await fetch(url, {
    headers: { 'apikey': apiKey },
  });

  if (!response.ok) {
    await throwEvolutionError(response, `Failed to fetch QR code: ${response.status}`);
  }

  return response.json(); // Usually returns { base64: "..." }
}

// ============================================================
// Sending Messages
// ============================================================

export interface SendEvolutionMessageArgs {
  config: EvolutionApiConfig;
  to: string;
  text: string;
}

export async function sendEvolutionTextMessage({ config, to, text }: SendEvolutionMessageArgs): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey, instanceName } = config;
  const url = `${apiUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`;
  
  // Clean phone number for Evolution API (needs country code, usually just numbers)
  const number = to.replace(/[^0-9]/g, '');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
    },
    body: JSON.stringify({
      number,
      text,
      delay: 1200, // Optional slight delay
    }),
  });

  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API send error: ${response.status}`);
  }

  const data = await response.json();
  return { messageId: data.key?.id || data.id || `evol-${Date.now()}` };
}

// ============================================================
// Webhooks
// ============================================================

export interface SetEvolutionWebhookArgs {
  config: EvolutionApiConfig;
  webhookUrl: string;
}

export async function setEvolutionWebhook({ config, webhookUrl }: SetEvolutionWebhookArgs) {
  const { apiUrl, apiKey, instanceName } = config;
  const url = `${apiUrl.replace(/\/$/, '')}/webhook/set/${instanceName}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
    },
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      }
    }),
  });

  if (!response.ok) {
    await throwEvolutionError(response, `Failed to set webhook: ${response.status}`);
  }

  return response.json();
}
