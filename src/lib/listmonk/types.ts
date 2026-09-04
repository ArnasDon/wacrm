// Shapes returned by the listmonk REST API (v6.x). Hand-written
// rather than generated: we only model the fields wacrm actually
// reads, so a listmonk release adding fields doesn't break the build.

export interface ListmonkList {
  id: number;
  uuid: string;
  name: string;
  type: 'public' | 'private';
  optin: 'single' | 'double';
  tags: string[];
  description: string;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListmonkSubscriber {
  id: number;
  uuid: string;
  email: string;
  name: string;
  status: 'enabled' | 'disabled' | 'blocklisted';
  attribs: Record<string, unknown>;
  lists: Array<{
    id: number;
    name?: string;
    subscription_status: 'unconfirmed' | 'confirmed' | 'unsubscribed';
  }>;
  created_at: string;
  updated_at: string;
}

export type ListmonkCampaignStatus =
  'draft' | 'scheduled' | 'running' | 'paused' | 'finished' | 'cancelled';

export interface ListmonkCampaign {
  id: number;
  uuid: string;
  name: string;
  subject: string;
  from_email: string;
  body: string;
  content_type: 'richtext' | 'html' | 'markdown' | 'plain' | 'visual';
  status: ListmonkCampaignStatus;
  type: 'regular' | 'optin';
  tags: string[];
  lists: Array<{ id: number; name: string }>;
  template_id: number | null;
  send_at: string | null;
  started_at: string | null;
  to_send: number;
  sent: number;
  views: number;
  clicks: number;
  bounces: number;
  created_at: string;
  updated_at: string;
}

export interface ListmonkTemplate {
  id: number;
  name: string;
  type: 'campaign' | 'campaign_visual' | 'tx';
  is_default: boolean;
}

export interface ListmonkCounts {
  subscribers: { total: number; blocklisted: number | null; orphans: number };
  lists: { total: number; private: number; public: number };
  campaigns: { total: number; by_status: Record<string, number> };
  messages: number;
}

/** listmonk wraps every success payload in `data`. */
export interface ListmonkEnvelope<T> {
  data: T;
}

/** Paginated collections add these alongside `results`. */
export interface ListmonkPage<T> {
  results: T[];
  total: number;
  per_page: number;
  page: number;
}
