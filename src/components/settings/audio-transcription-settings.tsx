'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mic2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SettingsPanelHead } from './settings-panel-head'

interface TranscriptionConfig {
  configured: boolean
  enabled?: boolean
  provider?: string
  model?: string
  language?: string
  timeout_seconds?: number
  ai_config_active?: boolean
  key_source?: 'dedicated' | 'primary' | 'missing'
  ready?: boolean
}

export function AudioTranscriptionSettings() {
  const { accountRole, profileLoading } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<TranscriptionConfig>({ configured: false })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/transcription-config', { cache: 'no-store' })
      const data = (await res.json()) as TranscriptionConfig & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar a configuração.')
      setConfig(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a configuração.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setEnabled = async (enabled: boolean) => {
    const previous = config.enabled
    setConfig((current) => ({ ...current, enabled }))
    setSaving(true)
    try {
      const res = await fetch('/api/ai/transcription-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Não foi possível guardar a configuração.')
      toast.success(enabled ? 'Transcrição de áudio activada.' : 'Transcrição de áudio desactivada.')
      await load()
    } catch (error) {
      setConfig((current) => ({ ...current, enabled: previous }))
      toast.error(error instanceof Error ? error.message : 'Não foi possível guardar a configuração.')
    } finally {
      setSaving(false)
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar…
      </div>
    )
  }

  const keyLabel =
    config.key_source === 'dedicated'
      ? 'Chave OpenAI dedicada (embeddings/transcrição)'
      : config.key_source === 'primary'
        ? 'Chave OpenAI principal da conta'
        : 'Nenhuma chave OpenAI disponível'

  return (
    <div>
      <SettingsPanelHead
        title="Transcrição de áudio"
        description="Controle como as notas de voz recebidas pelo WhatsApp são convertidas em texto."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic2 className="h-4 w-4 text-primary" /> Notas de voz WhatsApp
            </CardTitle>
            <CardDescription>
              A transcrição é feita pela OpenAI e o texto fica disponível no Inbox, automações, flows e respostas da IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Activar transcrição automática</p>
                <p className="text-xs text-muted-foreground">
                  Quando desligada, o áudio continua a ser recebido normalmente, mas não é enviado para transcrição.
                </p>
              </div>
              <Switch
                checked={config.enabled === true}
                onCheckedChange={setEnabled}
                disabled={!canEdit || saving || !config.configured}
              />
            </div>

            {!config.configured && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                Configure primeiro a IA da conta para poder utilizar transcrição de áudio.
              </div>
            )}

            {config.configured && !config.ready && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                A transcrição está configurada, mas não há uma chave OpenAI activa disponível. Configure uma chave OpenAI na área de IA.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Fornecedor" value={config.provider === 'openai' ? 'OpenAI' : 'OpenAI'} />
              <Info label="Modelo" value={config.model || 'whisper-1'} />
              <Info label="Idioma" value={config.language === 'auto' ? 'Detecção automática' : config.language || 'Detecção automática'} />
              <Info label="Tempo limite" value={`${config.timeout_seconds || 25} segundos`} />
              <Info label="Chave utilizada" value={keyLabel} />
              <Info label="Estado" value={config.ready ? 'Pronto' : 'Requer configuração'} />
            </div>

            <p className="text-xs text-muted-foreground">
              A utilização da transcrição pode gerar custos na conta OpenAI associada a este workspace. Se existir uma chave dedicada, ela tem prioridade; caso contrário, o CRM usa a chave OpenAI principal da conta.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}
