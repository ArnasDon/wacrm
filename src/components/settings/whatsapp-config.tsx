'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

export function WhatsAppConfig() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  
  const [provider, setProvider] = useState<'meta' | 'evolution'>('meta');
  const [evolutionApiUrl, setEvolutionApiUrl] = useState('');
  const [evolutionApiKey, setEvolutionApiKey] = useState('');
  const [evolutionInstanceName, setEvolutionInstanceName] = useState('');
  const [qrCodeData, setQrCodeData] = useState<{ base64?: string, state?: string } | null>(null);

  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/whatsapp/webhook`);
    }
  }, []);

  const fetchConfig = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      // Load form values from Supabase (shows what's in DB)
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load config row:', error);
      }

      if (data) {
        setConfig(data);
        setProvider(data.provider || 'meta');
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(data.provider !== 'evolution' ? MASKED_TOKEN : '');
        setVerifyToken('');
        setEvolutionApiUrl(data.evolution_api_url || '');
        setEvolutionApiKey(data.evolution_api_key ? MASKED_TOKEN : '');
        setEvolutionInstanceName(data.evolution_instance_name || '');
        setTokenEdited(false);
      } else {
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setEvolutionApiUrl('');
        setEvolutionApiKey('');
        setEvolutionInstanceName('');
        setTokenEdited(false);
      }

      // Then verify health via the API (decrypts token + pings Meta)
      if (data) {
        try {
          const res = await fetch('/api/whatsapp/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Falha ao carregar a configuração do WhatsApp');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchConfig(user.id);
  }, [authLoading, user, fetchConfig]);

  async function handleSave() {
    if (provider === 'meta') {
      if (!phoneNumberId.trim()) {
        toast.error('O ID do Número de Telefone é obrigatório');
        return;
      }
      if (!config && (!accessToken.trim() || !tokenEdited)) {
        toast.error('O Token de Acesso é obrigatório para a configuração inicial');
        return;
      }
    } else {
      if (!evolutionApiUrl.trim() || !evolutionInstanceName.trim()) {
        toast.error('A URL da API e o Nome da Instância são obrigatórios');
        return;
      }
      if (!config && (!evolutionApiKey.trim() || !tokenEdited)) {
        toast.error('A API Key é obrigatória para a configuração inicial');
        return;
      }
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        provider,
      };

      if (provider === 'meta') {
        payload.phone_number_id = phoneNumberId.trim();
        payload.waba_id = wabaId.trim() || null;
        payload.verify_token = verifyToken.trim() || null;

        if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
          payload.access_token = accessToken.trim();
        } else if (config && config.provider === 'meta') {
          toast.error('Por favor, reinsira o Token de Acesso para salvar as alterações');
          setSaving(false);
          return;
        }
      } else {
        payload.evolution_api_url = evolutionApiUrl.trim();
        payload.evolution_instance_name = evolutionInstanceName.trim();

        if (tokenEdited && evolutionApiKey !== MASKED_TOKEN && evolutionApiKey.trim()) {
          payload.evolution_api_key = evolutionApiKey.trim();
        } else if (config && config.provider === 'evolution') {
          toast.error('Por favor, reinsira a API Key da Evolution para salvar as alterações');
          setSaving(false);
          return;
        }
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Falha ao salvar a configuração');
        setSaving(false);
        return;
      }

      toast.success(
        data.phone_info?.verified_name
          ? `Conectado a ${data.phone_info.verified_name}`
          : 'Configuração salva com sucesso'
      );

      if (user) await fetchConfig(user.id);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Falha ao salvar a configuração');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Conectado a ${payload.phone_info.verified_name}`
            : 'Conexão com a API bem-sucedida'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'Falha na conexão com a API');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Teste de conexão falhou. Verifique a rede e tente novamente.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm('Isso excluirá a configuração atual do WhatsApp para que você possa reinserí-la. Continuar?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Falha ao redefinir a configuração');
        return;
      }

      toast.success('Configuração apagada. Agora você pode reinserir suas credenciais.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Falha ao redefinir a configuração');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL do webhook copiada para a área de transferência');
  }

  const fetchQrCode = useCallback(async () => {
    if (provider !== 'evolution' || connectionStatus === 'connected') return;
    try {
      const res = await fetch('/api/whatsapp/evolution/qr');
      if (res.ok) {
        const data = await res.json();
        setQrCodeData(data);
      }
    } catch (e) {
      console.error('Failed to fetch QR', e);
    }
  }, [provider, connectionStatus]);

  useEffect(() => {
    if (provider === 'evolution' && connectionStatus === 'disconnected' && config) {
      fetchQrCode();
      const interval = setInterval(fetchQrCode, 10000);
      return () => clearInterval(interval);
    }
  }, [provider, connectionStatus, config, fetchQrCode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-4">
      {/* Main config form */}
      <div className="space-y-6">
        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">
                  Token armazenado não pode ser descriptografado
                </AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">
                  {statusMessage}
                </AlertDescription>
                <Button
                  onClick={handleReset}
                  disabled={resetting}
                  size="sm"
                  className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Redefinindo...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" />
                      Redefinir Configuração
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection Status */}
        <Alert className="bg-slate-900 border-slate-700">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-white mb-0">
              {connectionStatus === 'connected' ? 'Conectado' : 'Não Conectado'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-slate-400">
            {connectionStatus === 'connected'
              ? 'Sua API do WhatsApp Business está conectada e pronta para enviar/receber mensagens.'
              : statusMessage ||
                'Configure suas credenciais da API da Meta abaixo para conectar sua conta do WhatsApp Business.'}
          </AlertDescription>
        </Alert>

        {/* API Credentials */}
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Provedor e Credenciais</CardTitle>
            <CardDescription className="text-slate-400">
              Selecione seu provedor e insira as credenciais da API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={provider} onValueChange={(val) => setProvider(val as 'meta' | 'evolution')} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="meta">API Oficial (Meta)</TabsTrigger>
                <TabsTrigger value="evolution">Evolution API</TabsTrigger>
              </TabsList>
              
              <TabsContent value="meta" className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">ID do Número de Telefone</Label>
                  <Input
                    placeholder="e.g. 100234567890123"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">ID da Conta do WhatsApp Business</Label>
                  <Input
                    placeholder="e.g. 100234567890456"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Token de Acesso Permanente</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder="Insira seu token de acesso"
                      value={accessToken}
                      onChange={(e) => {
                        setAccessToken(e.target.value);
                        setTokenEdited(true);
                      }}
                      onFocus={() => {
                        if (accessToken === MASKED_TOKEN) {
                          setAccessToken('');
                          setTokenEdited(true);
                        }
                      }}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {config && config.provider === 'meta' && !tokenEdited && (
                    <p className="text-xs text-slate-500">
                      Token ocultado por segurança. Reinsira-o para atualizar a configuração.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Token de Verificação do Webhook</Label>
                  <Input
                    placeholder="Crie um token de verificação personalizado"
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                  <p className="text-xs text-slate-500">
                    Uma string personalizada que você cria. Deve corresponder ao token que você definiu nas configurações de webhook da Meta.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="evolution" className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">URL da Evolution API</Label>
                  <Input
                    placeholder="e.g. https://api.evolution.com"
                    value={evolutionApiUrl}
                    onChange={(e) => setEvolutionApiUrl(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">API Key</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder="Global API Key ou Instance Token"
                      value={evolutionApiKey}
                      onChange={(e) => {
                        setEvolutionApiKey(e.target.value);
                        setTokenEdited(true);
                      }}
                      onFocus={() => {
                        if (evolutionApiKey === MASKED_TOKEN) {
                          setEvolutionApiKey('');
                          setTokenEdited(true);
                        }
                      }}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {config && config.provider === 'evolution' && !tokenEdited && (
                    <p className="text-xs text-slate-500">
                      Token ocultado por segurança. Reinsira-o para atualizar a configuração.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Nome da Instância</Label>
                  <Input
                    placeholder="e.g. minha-instancia"
                    value={evolutionInstanceName}
                    onChange={(e) => setEvolutionInstanceName(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                {provider === 'evolution' && config?.provider === 'evolution' && connectionStatus === 'disconnected' && qrCodeData?.base64 && (
                  <div className="mt-6 p-4 bg-white rounded-lg flex flex-col items-center justify-center">
                    <h4 className="text-slate-900 font-semibold mb-2">Leia o QR Code para conectar</h4>
                    <img src={qrCodeData.base64} alt="QR Code" className="w-48 h-48" />
                    <p className="text-slate-500 text-sm mt-2 text-center">
                      Abra o WhatsApp no seu celular, vá em Aparelhos Conectados e leia este código.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Configuração do Webhook</CardTitle>
            <CardDescription className="text-slate-400">
              {provider === 'meta' 
                ? 'Use esta URL como callback de webhook no Painel de Aplicativos da Meta.' 
                : 'Configure este Webhook na sua instância da Evolution API.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-slate-300">URL de Callback do Webhook</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={provider === 'meta' ? webhookUrl : webhookUrl.replace('/webhook', '/evolution-webhook')}
                  className="bg-slate-800 border-slate-700 text-slate-300 font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar Configuração'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !config}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <Zap className="size-4" />
                {!config ? 'Testar (Salve Primeiro)' : 'Testar Conexão da API'}
              </>
            )}
          </Button>
          {config && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Redefinindo...
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Redefinir Configuração
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Setup Instructions Sidebar */}
      <div>
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white text-base">Instruções de Configuração</CardTitle>
            <CardDescription className="text-slate-400">
              Siga estes passos para conectar sua API do WhatsApp Business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                    Criar um App na Meta
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Acesse <span className="text-primary">developers.facebook.com</span></li>
                    <li>Clique em &quot;Meus Apps&quot; e depois em &quot;Criar App&quot;</li>
                    <li>Selecione &quot;Negócios&quot; como tipo de app</li>
                    <li>Preencha os detalhes do app e crie</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                    Adicionar o Produto WhatsApp
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>No painel do seu app, clique em &quot;Adicionar Produto&quot;</li>
                    <li>Encontre &quot;WhatsApp&quot; e clique em &quot;Configurar&quot;</li>
                    <li>Siga o assistente de configuração para vincular sua empresa</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                    Obter Credenciais da API
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; Configuração da API</li>
                    <li>Copie seu <strong className="text-slate-200">ID do Número de Telefone</strong></li>
                    <li>Copie seu <strong className="text-slate-200">ID da Conta do WhatsApp Business</strong></li>
                    <li>Gere um <strong className="text-slate-200">Token de Acesso Permanente</strong> em Configurações Comerciais &gt; Usuários do Sistema</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                    Configurar Webhooks
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; Configuração</li>
                    <li>Clique em &quot;Editar&quot; na seção de Webhook</li>
                    <li>Cole a <strong className="text-slate-200">URL de Callback do Webhook</strong> acima</li>
                    <li>Insira o mesmo <strong className="text-slate-200">Token de Verificação</strong> que você definiu aqui</li>
                    <li>Assine o campo de webhook &quot;messages&quot;</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-4 pt-4 border-t border-slate-700">
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Documentação da API WhatsApp da Meta
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
