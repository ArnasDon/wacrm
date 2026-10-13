import { NextResponse } from 'next/server'
import { FORM_VERTICALS, publicFormSpec } from '@/lib/onboarding/spec'

/**
 * GET /api/onboarding/form-spec  (public: it only lists the questions)
 * What the onboarding Apps Script builds the Google Forms from.
 */
export function GET() {
  return NextResponse.json({ forms: FORM_VERTICALS.map(publicFormSpec) })
}
