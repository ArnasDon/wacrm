import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '../.env.local')

async function loadEnvFile() {
  try {
    const text = await fs.readFile(envPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...rest] = trimmed.split('=')
      const value = rest.join('=').trim()
      if (!process.env[key] && value) {
        process.env[key] = value
      }
    }
  } catch {
    // ignore if .env.local is not present
  }
}

await loadEnvFile()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis'
  )
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function main() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nom, role, passe')

  if (error) {
    throw error
  }

  if (!users || users.length === 0) {
    console.log('Aucun utilisateur trouvé dans public.users')
    return
  }

  for (const user of users) {
    const id = user.id
    const email = String(user.email || '').trim()
    const password = String(user.passe || '')
    const metadata = {
      nom: user.nom ?? null,
      role: user.role ?? null,
    }

    if (!email || !password) {
      console.log(`SKIP ${id ?? '<undefined>'} : email ou passe manquant`)
      continue
    }

    const { data: existingUser, error: existingError } = await supabase
      .from('auth.users')
      .select('id, email')
      .eq('email', email)
      .limit(1)
      .maybeSingle()

    if (existingError) {
      console.error(`ERREUR vérification existant ${email}:`, existingError)
      continue
    }

    if (existingUser) {
      console.log(`SKIP ${email} : déjà présent dans auth.users (id=${existingUser.id})`)
      continue
    }

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      id,
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    })

    if (createError) {
      console.error(`ERREUR création ${email}:`, createError)
    } else {
      console.log(`OK ${email} -> auth.users id=${createdUser?.id}`)
    }
  }

  console.log('Migration terminée')
}

main().catch((err) => {
  console.error('Migration échouée:', err)
  process.exit(1)
})
