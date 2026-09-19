import Link from "next/link";
import { Construction } from "lucide-react";

/**
 * Placeholder for modules still on the legacy Supabase data layer
 * (pipelines, broadcasts, automations, flows). Their components and
 * API routes are kept in the repo for the next migration phase, but
 * the pages don't mount them — without Supabase configured they
 * would crash on load.
 */
export function LegacyModuleNotice({ name }: { name: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
      <Construction className="mx-auto mb-3 size-8 text-amber-300" />
      <h2 className="text-lg font-semibold text-white">{name} is being upgraded</h2>
      <p className="mt-2 text-sm text-slate-400">
        This module is moving to the new database and will be back in a later release. Sales, orders,
        inventory and the AI sales rep are fully available.
      </p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
