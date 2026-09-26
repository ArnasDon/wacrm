import { NextResponse } from "next/server";
import {
  getSupabaseRequestCounts,
  resetSupabaseRequestCounts,
} from "@/lib/dev/supabase-request-counter";

// Dev-only diagnostic: hit GET before a workflow, DELETE to reset the
// tally, run the workflow, GET again and diff. 404s outside
// development so this never ships as a real endpoint.

function guard(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  return NextResponse.json({ counts: getSupabaseRequestCounts() });
}

export async function DELETE() {
  const blocked = guard();
  if (blocked) return blocked;
  resetSupabaseRequestCounts();
  return NextResponse.json({ reset: true });
}
