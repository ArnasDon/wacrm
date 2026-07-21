import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Remote template sync is unavailable with Z-API. Templates are managed locally in the database.',
    },
    { status: 501 },
  )
}
