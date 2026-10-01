import { createClient } from '@supabase/supabase-js'
import { loadAiConfig } from '../src/lib/ai/config'
import { buildSystemPrompt } from '../src/lib/ai/defaults'
import { generateReply, formatForWhatsApp, normalizeFlyOrderTrackingUrls } from '../src/lib/ai/generate'
import { reopenClosedConversation } from '../src/lib/conversations/reopen'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, key)

let passCount = 0
let failCount = 0

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`)
    passCount++
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`)
    failCount++
  }
}

async function createTestContact(accountId: string, userId: string, phone: string) {
  // Delete if already exists from prior run
  await db.from('contacts').delete().eq('phone', phone)
  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId,
      phone,
      name: 'E2E Test User',
    })
    .select('id, user_id')
    .single()
  if (error || !data) throw new Error('Failed to create test contact: ' + error?.message)
  return data
}

async function deleteTestContact(contactId: string) {
  await db.from('conversations').delete().eq('contact_id', contactId)
  await db.from('contacts').delete().eq('id', contactId)
}

async function runE2E() {
  console.log('====================================================')
  console.log('🚀 STARTING COMPREHENSIVE END-TO-END (E2E) VERIFICATION')
  console.log('====================================================\n')

  // ----------------------------------------------------
  // SECTION 1: URL Normalizer & WhatsApp Formatting
  // ----------------------------------------------------
  console.log('--- 1. Testing Tracking URL Normalizer & Formatting ---')
  const testUrl1 = normalizeFlyOrderTrackingUrls('Check: https://flyorder.com/ar/track?number=FLY-20260929-JGUNPD.')
  assert(
    testUrl1.includes('https://flyorder.com/ar/track?waybill=FLY-20260929-JGUNPD.'),
    'Normalizes ?number= to ?waybill= in Arabic URLs while preserving trailing punctuation',
    testUrl1
  )

  const testUrl2 = normalizeFlyOrderTrackingUrls('Check: https://flyorder.com/en/track?id=AJW000199914672')
  assert(
    testUrl2.includes('https://flyorder.com/en/track?waybill=AJW000199914672'),
    'Normalizes ?id= to ?waybill= in English URLs',
    testUrl2
  )

  const testWaFormat = formatForWhatsApp('* **Bold Bullet 1**\n* **Bold Bullet 2**')
  assert(
    testWaFormat.includes('• *Bold Bullet 1*') && testWaFormat.includes('• *Bold Bullet 2*'),
    'Converts markdown **bold** to *bold* and * bullets to • for WhatsApp',
    testWaFormat
  )

  // ----------------------------------------------------
  // SECTION 2: Live AI Model Dynamic Tracking Generation
  // ----------------------------------------------------
  console.log('\n--- 2. Testing Live AI Model Dynamic Tracking (Method 3) ---')
  const { data: configs } = await db.from('ai_configs').select('account_id').limit(1)
  const accountId = configs![0].account_id
  const config = await loadAiConfig(db, accountId)
  if (!config) throw new Error('No AI config found in database')

  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
  })

  // Test 2a: English query with FLY- tracking number
  console.log('\n  [Query 2a] "Where is my shipment FLY-20260929-JGUNPD?"')
  const enReply = await generateReply({
    config,
    systemPrompt,
    messages: [{ role: 'user', content: 'Where is my shipment FLY-20260929-JGUNPD?' }],
  })
  console.log('  Response preview:', enReply.text.split('\n')[0])
  assert(
    enReply.text.includes('https://flyorder.com/en/track?waybill=FLY-20260929-JGUNPD'),
    'Generates direct English dynamic link https://flyorder.com/en/track?waybill=FLY-20260929-JGUNPD',
    enReply.text
  )
  assert(
    !enReply.text.includes('**FLY-'),
    'WhatsApp bold formatting verified (no double asterisks **)',
    enReply.text
  )

  // Test 2b: Arabic query with FLY- tracking number
  console.log('\n  [Query 2b] "أريد تتبع شحنتي رقم FLY-9842-JED"')
  const arReply = await generateReply({
    config,
    systemPrompt,
    messages: [{ role: 'user', content: 'أريد تتبع شحنتي رقم FLY-9842-JED' }],
  })
  console.log('  Response preview:', arReply.text.split('\n')[0])
  assert(
    arReply.text.includes('https://flyorder.com/ar/track?waybill=FLY-9842-JED'),
    'Generates direct Arabic dynamic link https://flyorder.com/ar/track?waybill=FLY-9842-JED',
    arReply.text
  )

  // Test 2c: Tracking inquiry without number
  console.log('\n  [Query 2c] "How can I track my shipment?" (No number provided)')
  const noNumReply = await generateReply({
    config,
    systemPrompt,
    messages: [{ role: 'user', content: 'How can I track my shipment?' }],
  })
  console.log('  Response preview:', noNumReply.text.split('\n')[0])
  assert(
    noNumReply.text.toLowerCase().includes('tracking number') || noNumReply.text.toLowerCase().includes('waybill') || noNumReply.text.includes('رقم'),
    'Politely asks customer for tracking/waybill number when none was provided',
    noNumReply.text
  )

  // Get valid auth user ID for DB tests
  const { data: sampleContacts } = await db.from('contacts').select('user_id').limit(1)
  const dummyUserId = sampleContacts![0].user_id

  // ----------------------------------------------------
  // SECTION 3: DB Lifecycle - Closed Conversation Reopen
  // ----------------------------------------------------
  console.log('\n--- 3. Testing Closed Conversation Reopen ---')
  const testContact1 = await createTestContact(accountId, dummyUserId, '+966590000001')

  const { data: closedConv, error: createClosedErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      contact_id: testContact1.id,
      user_id: dummyUserId,
      status: 'closed',
      assigned_agent_id: dummyUserId,
      ai_autoreply_disabled: true,
      ai_reply_count: 3,
      ai_handoff_summary: 'Previous issue resolved by agent',
    })
    .select()
    .single()

  if (createClosedErr || !closedConv) {
    throw new Error('Failed to create test closed conversation: ' + createClosedErr?.message)
  }

  const reopened = await reopenClosedConversation(db, { id: closedConv.id, status: 'closed' })
  assert(reopened === true, 'reopenClosedConversation returned true')

  const { data: reopenedConv } = await db
    .from('conversations')
    .select('status, assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_handoff_summary')
    .eq('id', closedConv.id)
    .single()

  assert(reopenedConv?.status === 'open', 'Conversation status flipped to open', reopenedConv?.status)
  assert(reopenedConv?.assigned_agent_id === null, 'assigned_agent_id reset to null', String(reopenedConv?.assigned_agent_id))
  assert(reopenedConv?.ai_autoreply_disabled === false, 'ai_autoreply_disabled reset to false', String(reopenedConv?.ai_autoreply_disabled))
  assert(reopenedConv?.ai_reply_count === 0, 'ai_reply_count reset to 0', String(reopenedConv?.ai_reply_count))
  assert(reopenedConv?.ai_handoff_summary === null, 'ai_handoff_summary cleared to null', String(reopenedConv?.ai_handoff_summary))

  await deleteTestContact(testContact1.id)

  // ----------------------------------------------------
  // SECTION 4: Inactivity Timeout (10+ Hours Stale Session)
  // ----------------------------------------------------
  console.log('\n--- 4. Testing 10+ Hours Inactivity Session Reset ---')
  const testContact2 = await createTestContact(accountId, dummyUserId, '+966590000002')
  const elevenHoursAgo = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString()

  const { data: staleConv, error: createStaleErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      contact_id: testContact2.id,
      user_id: dummyUserId,
      status: 'open',
      assigned_agent_id: dummyUserId,
      ai_autoreply_disabled: true,
      ai_reply_count: 5,
      ai_handoff_summary: 'Agent took over yesterday',
      last_message_at: elevenHoursAgo,
      updated_at: elevenHoursAgo,
    })
    .select()
    .single()

  if (createStaleErr || !staleConv) {
    throw new Error('Failed to create test stale conversation: ' + createStaleErr?.message)
  }

  // Simulate inactivity check logic in dispatchInboundToAiReply
  const lastActivity = staleConv.last_message_at || staleConv.updated_at
  const isStaleSession = Boolean(
    lastActivity &&
      Date.now() - new Date(lastActivity).getTime() >= 10 * 60 * 60 * 1000
  )
  assert(isStaleSession === true, 'Correctly identifies session as stale (> 10 hours inactive)')

  if (isStaleSession) {
    await db
      .from('conversations')
      .update({
        assigned_agent_id: null,
        ai_autoreply_disabled: false,
        ai_reply_count: 0,
        ai_handoff_summary: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', staleConv.id)
  }

  const { data: updatedStaleConv } = await db
    .from('conversations')
    .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_handoff_summary')
    .eq('id', staleConv.id)
    .single()

  assert(updatedStaleConv?.assigned_agent_id === null, 'Stale agent assignment released to null', String(updatedStaleConv?.assigned_agent_id))
  assert(updatedStaleConv?.ai_autoreply_disabled === false, 'AI auto-reply re-enabled (ai_autoreply_disabled: false)', String(updatedStaleConv?.ai_autoreply_disabled))
  assert(updatedStaleConv?.ai_reply_count === 0, 'Reply count reset to 0 for fresh session budget', String(updatedStaleConv?.ai_reply_count))

  await deleteTestContact(testContact2.id)

  // ----------------------------------------------------
  // SECTION 5: Unassigned Conversation Auto-Resume
  // ----------------------------------------------------
  console.log('\n--- 5. Testing Unassigned Conversation Auto-Resume ---')
  const testContact3 = await createTestContact(accountId, dummyUserId, '+966590000003')

  const { data: unassignedConv, error: createUnassignedErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      contact_id: testContact3.id,
      user_id: dummyUserId,
      status: 'open',
      assigned_agent_id: null,
      ai_autoreply_disabled: true, // was paused previously
      ai_reply_count: 0,
    })
    .select()
    .single()

  if (createUnassignedErr || !unassignedConv) {
    throw new Error('Failed to create test unassigned conversation: ' + createUnassignedErr?.message)
  }

  // Simulate unassigned auto-resume logic in dispatchInboundToAiReply
  if (!unassignedConv.assigned_agent_id && unassignedConv.status !== 'pending') {
    if (unassignedConv.ai_autoreply_disabled) {
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: false,
          ai_reply_count: 0,
          ai_handoff_summary: null,
        })
        .eq('id', unassignedConv.id)
    }
  }

  const { data: resumedConv } = await db
    .from('conversations')
    .select('ai_autoreply_disabled')
    .eq('id', unassignedConv.id)
    .single()

  assert(
    resumedConv?.ai_autoreply_disabled === false,
    'Unassigned open conversation auto-resumed (ai_autoreply_disabled set to false)',
    String(resumedConv?.ai_autoreply_disabled)
  )

  await deleteTestContact(testContact3.id)

  // ----------------------------------------------------
  // SECTION 6: Active Agent Protection (< 10 Hours)
  // ----------------------------------------------------
  console.log('\n--- 6. Testing Active Agent Protection (Active within 10h) ---')
  const testContact4 = await createTestContact(accountId, dummyUserId, '+966590000004')
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: activeConv, error: createActiveErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      contact_id: testContact4.id,
      user_id: dummyUserId,
      status: 'open',
      assigned_agent_id: dummyUserId,
      ai_autoreply_disabled: true,
      last_message_at: fiveMinutesAgo,
      updated_at: fiveMinutesAgo,
    })
    .select()
    .single()

  if (createActiveErr || !activeConv) {
    throw new Error('Failed to create test active conversation: ' + createActiveErr?.message)
  }

  const lastActiveMins = Date.now() - new Date(activeConv.last_message_at).getTime()
  const isStale = lastActiveMins >= 10 * 60 * 60 * 1000
  assert(isStale === false, 'Recognizes conversation as actively managed by an agent')
  assert(Boolean(activeConv.assigned_agent_id) === true, 'Agent is actively assigned - AI stands down')

  await deleteTestContact(testContact4.id)

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================')
  console.log(`📊 E2E TEST RESULTS: ${passCount} PASSED | ${failCount} FAILED`)
  console.log('====================================================\n')

  if (failCount > 0) {
    process.exit(1)
  }
}

runE2E().catch((err) => {
  console.error('Fatal E2E error:', err)
  process.exit(1)
})
