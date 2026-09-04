'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { readResponseJson } from '@/lib/http/response-json';

interface DemoMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PROMPT_KEY = 'sandia:ai-demo:prompt';
const MESSAGES_KEY = 'sandia:ai-demo:messages';

const EXAMPLE_PROMPT = `Eres el asistente de WhatsApp de "Nombre de la empresa", un [rubro] en Guatemala.

Tono: cercano y profesional, tratás de "vos". Respuestas cortas.

Qué sabés:
- Horario: lunes a sábado de 8:00 a 18:00.
- Ubicación y cómo llegar: [dirección].
- Productos / servicios y precios de referencia: [listado].
- Formas de pago: efectivo, transferencia, tarjeta.

Qué hacés:
- Respondés dudas frecuentes con la información de arriba.
- Cuando alguien quiere comprar o cotizar, pedís: qué necesita, cantidad y fecha.
- No inventás precios ni prometés plazos que no estén acá.
- Si piden un descuento, un caso especial o algo que no sabés, decís que lo pasás con un asesor.`;

export function AiDemo() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore a demo in progress (survives an accidental refresh mid-pitch).
  useEffect(() => {
    try {
      const p = localStorage.getItem(PROMPT_KEY);
      setPrompt(p && p.trim() ? p : EXAMPLE_PROMPT);
      const m = localStorage.getItem(MESSAGES_KEY);
      if (m) {
        const parsed = JSON.parse(m) as DemoMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.slice(-40));
      }
    } catch {
      setPrompt(EXAMPLE_PROMPT);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROMPT_KEY, prompt);
    } catch {
      /* private window / storage disabled — the demo still works */
    }
  }, [prompt]);

  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || loading) return;
    if (!prompt.trim()) {
      setError('Escribe primero el prompt de la empresa.');
      return;
    }
    setError(null);
    const next: DemoMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/demo-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: prompt, messages: next }),
      });
      const data = await readResponseJson<{ reply?: string; error?: string }>(
        res,
      ).catch(() => ({}) as { reply?: string; error?: string });
      if (!res.ok || !data.reply) {
        setError(data.error || `Error al responder (HTTP ${res.status}).`);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply as string },
      ]);
    } catch {
      setError('No se pudo contactar al servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [draft, loading, prompt, messages]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(MESSAGES_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="text-primary size-5" />
          Demo de IA para clientes
        </CardTitle>
        <CardDescription>
          Pegá el prompt que tendría la empresa y chateá con el asistente para
          mostrarle a un prospecto cómo respondería Sandía con su propia
          configuración. No se guarda nada; es solo para la demostración.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ai-demo-prompt">Prompt de la empresa</Label>
          <Textarea
            id="ai-demo-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder={EXAMPLE_PROMPT}
          />
          <p className="text-muted-foreground text-xs">
            Reemplazá los campos entre corchetes con los datos reales del
            prospecto antes de la demo.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Conversación de prueba</Label>
            {messages.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                className="h-7 px-2 text-xs"
              >
                <Eraser className="size-3.5" />
                Limpiar
              </Button>
            ) : null}
          </div>
          <div
            ref={scrollRef}
            className="bg-muted/30 h-72 space-y-3 overflow-y-auto rounded-lg border p-3"
          >
            {messages.length === 0 ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
                <Bot className="size-6 opacity-50" />
                Escribe un mensaje como si fueras el cliente.
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user' ? 'flex justify-end' : 'flex justify-start'
                  }
                >
                  <div
                    className={
                      'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ' +
                      (m.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-background rounded-bl-sm border')
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {loading ? (
              <div className="flex justify-start">
                <div className="bg-background text-muted-foreground rounded-2xl rounded-bl-sm border px-3 py-2 text-sm">
                  Pensando…
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Mensaje del cliente…"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !draft.trim()}>
              <Send className="size-4" />
              Enviar
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
