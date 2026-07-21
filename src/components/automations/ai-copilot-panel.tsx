"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, Loader2, AlertTriangle, Send } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { triggerMeta } from "@/lib/automations/trigger-meta"

interface GeneratedAutomation {
  name: string
  description: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  steps: { step_type: string; step_config: Record<string, unknown>; branch: 'yes' | 'no' | null; parent_index: number | null }[]
}

interface ValidationIssue {
  path: string
  message: string
}

type Turn =
  | { kind: 'question'; text: string }
  | { kind: 'draft'; automation: GeneratedAutomation; issues: ValidationIssue[] }

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
}

export function AiCopilotPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const t = useTranslations("Automations.copilot")
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<ChatEntry[]>([])
  const [lastTurn, setLastTurn] = useState<Turn | null>(null)
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)

  function reset() {
    setInput("")
    setHistory([])
    setLastTurn(null)
  }

  async function handleSend() {
    const message = input.trim()
    if (!message) return
    setSending(true)
    setInput("")
    setHistory((h) => [...h, { role: 'user', text: message }])
    try {
      const res = await fetch("/api/automations/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("genericError"))
        return
      }
      if (data.kind === 'question') {
        setHistory((h) => [...h, { role: 'assistant', text: data.text }])
        setLastTurn({ kind: 'question', text: data.text })
      } else {
        setLastTurn({ kind: 'draft', automation: data.automation, issues: data.issues })
      }
    } catch {
      toast.error(t("networkError"))
    } finally {
      setSending(false)
    }
  }

  async function handleCreateDraft() {
    if (!lastTurn || lastTurn.kind !== 'draft') return
    setCreating(true)
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...lastTurn.automation, is_active: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? t("createError"))
        return
      }
      toast.success(t("draftCreated"))
      onOpenChange(false)
      reset()
      router.push(`/automations/${data.automation.id}/edit`)
    } catch {
      toast.error(t("createError"))
    } finally {
      setCreating(false)
    }
  }

  const draft = lastTurn?.kind === 'draft' ? lastTurn : null

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {history.map((entry, i) => (
            <p key={i} className={entry.role === 'user' ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
              <span className="font-medium">{entry.role === 'user' ? t("you") : t("assistant")}: </span>
              {entry.text}
            </p>
          ))}
        </div>

        {draft && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{draft.automation.name}</p>
              {draft.automation.description && (
                <p className="text-xs text-muted-foreground">{draft.automation.description}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("triggerLabel")}: {triggerMeta(draft.automation.trigger_type).label}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {draft.automation.steps.map((s, i) => (
                <li key={i}>{i + 1}. {s.step_type}{s.parent_index !== null ? ` (${t("branch")}: ${s.branch})` : ""}</li>
              ))}
            </ul>
            {draft.issues.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("needsReview", { count: draft.issues.length })}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("placeholder")}
            maxLength={2000}
            className="bg-muted text-foreground"
            onKeyDown={(e) => { if (e.key === 'Enter' && !sending) handleSend() }}
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        {draft && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLastTurn(null)} disabled={creating}>
              {t("tryAgain")}
            </Button>
            <Button onClick={handleCreateDraft} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("createDraft")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
