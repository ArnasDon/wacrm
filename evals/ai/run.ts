// ============================================================
// `npm run eval:ai [-- <accountId>]`
//
// Builds the REAL production system prompt for one account — by
// calling the actual buildSystemPrompt()/loadCatalogContext() the app
// itself uses, not a hand-copied reconstruction — decrypts that
// account's configured AI API key, then runs `promptfoo eval` against
// the real provider/model, all in one Node process (no shell-specific
// env-var-from-file tricks, so this works the same on Windows/macOS/
// Linux).
//
// promptfoo itself is DELIBERATELY installed in evals/ai/'s own
// isolated package.json, not the root one — never a root
// devDependency. Incident 2026-09-16: promptfoo pulls in
// @huggingface/transformers as an *optional* dependency, which drags
// in onnxruntime-node's ~211MB of native binaries; once that landed in
// the root package-lock.json, the production Dockerfile's `npm ci`
// installed it too (Docker doesn't know or care that it's a "dev-only,
// local-eval-only" tool), pushing a build from ~2-3min to 6+min and
// crashing the build host mid-build. Keeping promptfoo in its own
// nested package.json means the root lockfile the Dockerfile reads
// never contains it, full stop — not "should be omitted by a flag",
// structurally absent. `main()` below installs it on first run if
// evals/ai/node_modules isn't there yet.
//
// Writes one LOCAL, gitignored file for inspection (never committed,
// the key itself is never written to disk or printed):
//   evals/ai/system-prompt.local.txt — the exact prompt text tested
//
// Defaults to Villa San Ricardo (the hotel vertical account
// promptfooconfig.yaml's test cases were written against). Pass a
// different account id to test another account — you'll likely also
// need to adjust promptfooconfig.yaml's `providers` entry if that
// account uses a different AI provider than OpenAI.
// ============================================================
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { loadCatalogContext } from '@/lib/ai/catalog-context'
import { decrypt } from '@/lib/whatsapp/encryption'

const DEFAULT_ACCOUNT_ID = '09cd99b6-db6e-4644-a76b-01b11f7364f7' // Villa San Ricardo

async function main() {
  const accountId = process.argv[2] || DEFAULT_ACCOUNT_ID

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ENCRYPTION_KEY) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ENCRYPTION_KEY in .env (same values the app itself uses).',
    )
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: config, error } = await db
    .from('ai_configs')
    .select('provider, model, api_key, system_prompt, ask_customer_tax_info')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !config) throw new Error(`ai_configs not found for account ${accountId}: ${error?.message}`)
  if (!config.api_key) throw new Error(`Account ${accountId} has no AI API key configured yet.`)

  const { data: account } = await db
    .from('accounts')
    .select('catalog_delivery_mode, restaurant_menu_url, industry_vertical')
    .eq('id', accountId)
    .maybeSingle()

  const catalog = await loadCatalogContext(db, accountId)
  const isHotel = account?.industry_vertical === 'hotel'

  const now = new Date()
  const currentDate =
    now.toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
    ', ' +
    now.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) +
    ' (America/Guatemala)'

  const systemPrompt = buildSystemPrompt({
    userPrompt: config.system_prompt,
    mode: 'auto_reply',
    catalog,
    catalogDeliveryMode: (account?.catalog_delivery_mode as 'digital' | 'pdf' | 'photos' | undefined) ?? 'digital',
    hotelReservations: isHotel,
    restaurantMenu: Boolean(account?.restaurant_menu_url),
    currentDate,
    askCustomerTaxInfo: Boolean(config.ask_customer_tax_info),
  })

  writeFileSync(`${__dirname}/system-prompt.local.txt`, systemPrompt, 'utf8')

  console.log(`Testing account ${accountId} — ${config.provider}/${config.model}`)
  console.log(`System prompt: ${systemPrompt.length} chars, ${catalog?.length ?? 0} catalog products.`)
  console.log(`(Full text written to evals/ai/system-prompt.local.txt for inspection — not committed.)\n`)

  if (config.provider !== 'openai') {
    console.warn(
      `⚠ This account's provider is "${config.provider}", but promptfooconfig.yaml is set up for openai:chat. ` +
        `Edit the "providers" entry in evals/ai/promptfooconfig.yaml to match before this eval will call the right model.`,
    )
  }

  if (!existsSync(`${__dirname}/node_modules`)) {
    console.log('First run — installing promptfoo into evals/ai/ (isolated from the root project)...\n')
    const install = spawnSync('npm', ['install'], { cwd: __dirname, stdio: 'inherit', shell: true })
    if (install.status !== 0) process.exit(install.status ?? 1)
  }

  const result = spawnSync('npx', ['promptfoo', 'eval', '-c', 'promptfooconfig.yaml'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PROVIDER_KEY: decrypt(config.api_key) },
  })
  process.exit(result.status ?? 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
