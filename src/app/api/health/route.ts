import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  console.log("[HEALTH] START");

  const timestamp = new Date().toISOString();

  try {
    console.log("[HEALTH] BEFORE createClient");

    const supabase = await createClient();

    console.log("[HEALTH] AFTER createClient");

    console.log("[HEALTH] BEFORE QUERY");

    const { error } = await supabase
      .from("profiles")
      .select("user_id")
      .limit(1);

    console.log("[HEALTH] AFTER QUERY", error);

    const dbHealthy = !error;

    return NextResponse.json(
      {
        status: dbHealthy ? "ok" : "degraded",
        service: "wacrm",
        version: process.env.npm_package_version ?? "0.2.2",
        timestamp,
        checks: {
          application: "ok",
          database: dbHealthy ? "ok" : "failed",
        },
      },
      {
        status: dbHealthy ? 200 : 503,
      }
    );

  } catch (err) {

    console.error("[HEALTH] ERROR", err);

    return NextResponse.json(
      {
        status: "failed",
        service: "wacrm",
        timestamp,
        checks: {
          application: "ok",
          database: "failed",
        },
      },
      {
        status: 503,
      }
    );
  }
}