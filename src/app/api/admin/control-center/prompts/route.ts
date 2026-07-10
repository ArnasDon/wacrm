import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Prompt API is under development.",
    data: [],
  });
}