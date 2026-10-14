'use client';
import { useState } from 'react';
import { apiResult } from '@/lib/api/client';
import type { MessageTemplate } from '@/types';
import type { AudienceConfig, VariableMapping } from '@/lib/broadcast-audience';
export { resolveVariables } from '@/lib/broadcast-audience';
export type {
  AudienceConfig,
  VariableMapping,
  CustomFieldFilter,
  CustomFieldOperator,
} from '@/lib/broadcast-audience';
interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl?: string;
}
export function useBroadcastSending() {
  const [isProcessing, setIsProcessing] = useState(false),
    [progress, setProgress] = useState(0);
  async function createAndSendBroadcast(payload: BroadcastPayload) {
    setIsProcessing(true);
    setProgress(10);
    try {
      const { data, error } = await apiResult<{ broadcast_id: string }>(
        '/api/broadcasts',
        {
          method: 'POST',
          body: JSON.stringify({ ...payload, templateId: payload.template.id }),
        }
      );
      if (error || !data)
        throw new Error(error?.message ?? 'Broadcast failed.');
      setProgress(100);
      return data.broadcast_id;
    } finally {
      setIsProcessing(false);
    }
  }
  return { createAndSendBroadcast, isProcessing, progress };
}
