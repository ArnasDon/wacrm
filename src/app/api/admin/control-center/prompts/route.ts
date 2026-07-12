import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export async function GET() {

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_prompts")
    .select(`
      id,
      account_id,
      provider,
      scope,
      intent,
      name,
      system_prompt,
      version,
      enabled,
      updated_at
    `)
    .order("provider")
    .order("version", {
      ascending: false,
    });

  if (error) {

    console.error("[Prompt API]", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      },
    );

  }

  return NextResponse.json({
    success: true,
    data,
  });

}

export async function POST(
  request: Request,
) {

  const body = await request.json();

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_prompts")
    .insert({
      account_id: body.accountId ?? null,
      provider: body.provider,
      scope: body.scope ?? "global",
      intent: body.intent ?? null,
      name: body.name,
      system_prompt: body.systemPrompt,
      version: body.version ?? 1,
      enabled: true,
    })
    .select()
    .single();

  if (error) {

    console.error("[Prompt API]", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      },
    );

  }

  return NextResponse.json({
    success: true,
    data,
  });

}

export async function PUT(
  request: Request,
) {

  const body = await request.json();

  const db = supabaseAdmin();

  // Existing prompt fetch karo
  const { data: existing, error: fetchError } =
    await db
      .from("ai_prompts")
      .select("version")
      .eq("id", body.id)
      .single();

  if (fetchError || !existing) {

    return NextResponse.json(
      {
        success: false,
        message: "Prompt not found.",
      },
      {
        status: 404,
      },
    );

  }

  const { data, error } = await db
    .from("ai_prompts")
    .update({
      name: body.name,
      provider: body.provider,
      scope: body.scope,
      intent: body.intent ?? null,
      system_prompt: body.systemPrompt,
      enabled: body.enabled ?? true,

      // automatic version increment
      version: existing.version + 1,

      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) {

    console.error("[Prompt API]", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      },
    );

  }

  return NextResponse.json({
    success: true,
    data,
  });

}

export async function DELETE(
  request: Request,
) {

  const body = await request.json();

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_prompts")
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) {

    console.error("[Prompt API]", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      },
    );

  }

  return NextResponse.json({
    success: true,
    data,
  });

}