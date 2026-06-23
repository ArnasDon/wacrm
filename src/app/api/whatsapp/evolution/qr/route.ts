import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEvolutionInstanceQR } from '@/lib/whatsapp/evolution-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('provider, evolution_api_url, evolution_api_key, evolution_instance_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (configError || !config || config.provider !== 'evolution') {
      return NextResponse.json({ error: 'Evolution config not found' }, { status: 400 })
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.evolution_api_key)
    } catch (err) {
      return NextResponse.json({ error: 'Token corrupted' }, { status: 500 })
    }

    const qrData = await getEvolutionInstanceQR({
      config: {
        apiUrl: config.evolution_api_url,
        apiKey,
        instanceName: config.evolution_instance_name,
      }
    })

    return NextResponse.json(qrData)
  } catch (error) {
    console.error('Error fetching Evolution QR:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
