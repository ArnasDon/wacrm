import {
  Building2,
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Receipt,
  Shield,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AccountRole } from '@/lib/auth/roles';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'business',
  'whatsapp',
  'templates',
  'quick-replies',
  'fields',
  'deals',
  'usage',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `minRole` controls the lowest role that may SEE the section. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  minRole?: AccountRole;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top', minRole: 'viewer' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account', minRole: 'viewer' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account', minRole: 'viewer' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account', minRole: 'viewer' },
  business: { id: 'business', label: 'Business profile', icon: Building2, group: 'workspace', minRole: 'admin' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', minRole: 'admin' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace', minRole: 'admin' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace', minRole: 'admin' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace', minRole: 'admin' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace', minRole: 'admin' },
  usage: { id: 'usage', label: 'Usage & billing', icon: Receipt, group: 'workspace', minRole: 'admin' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace', minRole: 'admin' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace', minRole: 'admin' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
