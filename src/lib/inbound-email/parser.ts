import { loadAiConfig } from '@/lib/ai/config';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { generateOpenAi } from '@/lib/ai/providers/openai';
import { generateAnthropic } from '@/lib/ai/providers/anthropic';
import type { ChatMessage } from '@/lib/ai/types';

export interface ParsedLead {
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
}

export async function parseInboundEmail(
  accountId: string,
  subject: string,
  text: string
): Promise<ParsedLead | null> {
  const content = (subject + '\n' + text).toLowerCase();

  // 1. Template matching (Regex)
  let source = 'email_lead';
  if (content.includes('99acres')) source = '99acres';
  else if (content.includes('magicbricks')) source = 'magicbricks';
  else if (content.includes('housing.com')) source = 'housing.com';

  // Basic regex for Indian numbers or international
  // For the sake of this test, let's try to find Phone, Name, Email.
  const phoneMatch =
    text.match(/phone:?\s*([+\d -]{10,15})/i) ||
    text.match(/(?:mobile|ph|contact|no):?\s*([+\d -]{10,15})/i);
  const nameMatch = text.match(/name:?\s*([^\n]+)/i);
  const emailMatch = text.match(/email:?\s*([^\s]+@[^\s]+)/i);

  if (phoneMatch) {
    const phone = phoneMatch[1].replace(/[- ]/g, '').trim();
    if (phone.length >= 10) {
      return {
        name: nameMatch ? nameMatch[1].trim() : null,
        phone,
        email: emailMatch ? emailMatch[1].trim() : null,
        source,
      };
    }
  }

  // 2. LLM Fallback
  const config = await loadAiConfig(supabaseAdmin(), accountId, {
    requireActive: false,
  });
  if (!config) {
    console.warn('[inbound-email] No AI config found, and templates failed.');
    return null;
  }

  const systemPrompt = `You are a lead extractor. Extract Name, Phone, and Email from the following email. Return ONLY a JSON object with keys: "name" (string or null), "phone" (string with leading + if possible), "email" (string or null). If no phone is found, return null for phone. DO NOT wrap in markdown blocks, just raw JSON.`;

  const messages: ChatMessage[] = [
    { role: 'user', content: `Subject: ${subject}\n\n${text}` },
  ];

  let jsonText = '';
  try {
    if (config.provider === 'openai') {
      const res = await generateOpenAi({
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt,
        messages,
        timeoutMs: 15000,
      });
      jsonText = res.text;
    } else if (config.provider === 'anthropic') {
      const res = await generateAnthropic({
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt,
        messages,
        timeoutMs: 15000,
      });
      jsonText = res.text;
    }

    // clean markdown blocks if any
    jsonText = jsonText
      .replace(/^```json/i, '')
      .replace(/```$/, '')
      .trim();
    const data = JSON.parse(jsonText);

    if (!data.phone) return null;
    return {
      name: data.name || null,
      phone: data.phone.toString(),
      email: data.email || null,
      source: data.source || 'email_parser_ai',
    };
  } catch (err) {
    console.error('[inbound-email] LLM extraction failed:', err);
    return null;
  }
}
