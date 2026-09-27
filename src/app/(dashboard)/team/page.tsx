import { requireRole } from '@/lib/auth/account';
import { redirect } from 'next/navigation';
import { TeamDashboardClient } from './team-client';

export default async function TeamPage() {
  // G1: Role-gated route (owner/admin only)
  try {
    await requireRole('admin');
  } catch {
    redirect('/dashboard');
  }

  return <TeamDashboardClient />;
}
