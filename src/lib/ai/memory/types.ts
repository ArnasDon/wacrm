export interface CustomerMemory {
  accountId: string;
  contactId: string;
  conversationId?: string;

  summary: string;
  summaryHash: string;

  memoryVersion: number;

  lastUpdatedBy: string;

  archived: boolean;

  lastMessageAt: string;

  expiresAt: string;
}

export interface CustomerPreference {
  accountId: string;
  contactId: string;

  language?: string;

  preferredService?: string;

  preferredTherapist?: string;

  preferredVisitTime?: string;

  notes?: string;
}