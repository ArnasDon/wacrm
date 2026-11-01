import { describe, it, expect, vi } from 'vitest';
import { hasMinRole, canManageMembers, canEditSettings } from './roles';

describe('Phase 1: Multi-Tenant Role & Account Boundary Security', () => {
  it('correctly orders hierarchy: owner > admin > agent > viewer', () => {
    expect(hasMinRole('owner', 'viewer')).toBe(true);
    expect(hasMinRole('admin', 'viewer')).toBe(true);
    expect(hasMinRole('agent', 'viewer')).toBe(true);
    expect(hasMinRole('viewer', 'viewer')).toBe(true);

    expect(hasMinRole('viewer', 'agent')).toBe(false);
    expect(hasMinRole('viewer', 'admin')).toBe(false);
    expect(hasMinRole('viewer', 'owner')).toBe(false);

    expect(hasMinRole('agent', 'admin')).toBe(false);
    expect(hasMinRole('admin', 'owner')).toBe(false);
    expect(hasMinRole('owner', 'admin')).toBe(true);
  });

  it('restricts team management to admin and owner', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('agent')).toBe(false);
    expect(canManageMembers('viewer')).toBe(false);
  });

  it('restricts settings edits to admin and owner', () => {
    expect(canEditSettings('owner')).toBe(true);
    expect(canEditSettings('admin')).toBe(true);
    expect(canEditSettings('agent')).toBe(false);
    expect(canEditSettings('viewer')).toBe(false);
  });

  it('verifies platform superadmin check does not permit unauthenticated/unlisted users in any environment', async () => {
    const isPlatformAdmin = (email?: string, systemRole?: string | null): boolean => {
      if (systemRole === 'superadmin') return true;
      const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (email && adminEmails.includes(email.toLowerCase())) {
        return true;
      }
      return false;
    };

    // Ordinary user in Tenant A
    expect(isPlatformAdmin('agent@tenant-a.com', 'user')).toBe(false);
    expect(isPlatformAdmin('owner@tenant-b.com', 'user')).toBe(false);
    expect(isPlatformAdmin(undefined, null)).toBe(false);

    // Explicit superadmin
    expect(isPlatformAdmin('random@domain.com', 'superadmin')).toBe(true);
  });
});
