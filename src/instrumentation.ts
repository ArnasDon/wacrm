// Dev-only: tally outbound Supabase requests so `npm run dev` prints a
// before/after comparison when tuning caching/batching. No-op in any
// non-development environment — see supabase-request-counter.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NODE_ENV !== "development") return;
  const { installSupabaseRequestCounter } = await import(
    "@/lib/dev/supabase-request-counter"
  );
  installSupabaseRequestCounter();
}
