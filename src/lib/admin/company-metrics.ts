export interface HandoffConversation {
  id: string;
  ai_handoff_at: string;
}

export interface HumanReply {
  conversation_id: string;
  created_at: string;
}

export interface CompanyHandoffMetrics {
  transferred: number;
  attended: number;
  pending: number;
  avgResponseMinutes: number | null;
}

export function computeCompanyHandoffMetrics(
  handoffs: HandoffConversation[],
  replies: HumanReply[]
): CompanyHandoffMetrics {
  const handoffTimes = new Map(
    handoffs.map((row) => [row.id, new Date(row.ai_handoff_at).getTime()])
  );
  const firstReply = new Map<string, number>();

  for (const reply of replies) {
    if (firstReply.has(reply.conversation_id)) continue;
    const handoffAt = handoffTimes.get(reply.conversation_id);
    const repliedAt = new Date(reply.created_at).getTime();
    if (handoffAt !== undefined && repliedAt > handoffAt) {
      firstReply.set(reply.conversation_id, repliedAt);
    }
  }

  const waits = handoffs.flatMap((handoff) => {
    const repliedAt = firstReply.get(handoff.id);
    if (repliedAt === undefined) return [];
    return [(repliedAt - handoffTimes.get(handoff.id)!) / 60_000];
  });

  return {
    transferred: handoffs.length,
    attended: waits.length,
    pending: handoffs.length - waits.length,
    avgResponseMinutes:
      waits.length > 0
        ? waits.reduce((total, minutes) => total + minutes, 0) / waits.length
        : null,
  };
}
