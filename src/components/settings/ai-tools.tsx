'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, Wrench, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';

type ToolType = 'google_sheet' | 'api';

interface ApiParamRow {
  name: string;
  description: string;
  required: boolean;
}

interface HeaderRow {
  key: string;
  value: string;
}

interface ToolSummary {
  id: string;
  name: string;
  description: string;
  type: ToolType;
  sheet_url: string | null;
  api_url: string | null;
  api_method: 'GET' | 'POST';
  api_params: ApiParamRow[];
  api_headers: Record<string, string>;
  api_body: string | null;
  has_api_key: boolean;
  is_active: boolean;
  updated_at: string;
}

/** Editor target: 'new' when creating, a tool id when editing, null when closed. */
type EditTarget = 'new' | string | null;

const emptyParam = (): ApiParamRow => ({ name: '', description: '', required: false });
const emptyHeader = (): HeaderRow => ({ key: '', value: '' });

export function AiToolsCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ToolType>('google_sheet');
  const [sheetUrl, setSheetUrl] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState<'GET' | 'POST'>('GET');
  const [apiParams, setApiParams] = useState<ApiParamRow[]>([]);
  const [apiHeaders, setApiHeaders] = useState<HeaderRow[]>([]);
  const [apiBody, setApiBody] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiTools');

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/tools');
      const data = await res.json();
      if (res.ok) setTools(data.tools ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchTools();
  }, [accountId, fetchTools]);

  const resetFields = () => {
    setName('');
    setDescription('');
    setType('google_sheet');
    setSheetUrl('');
    setApiUrl('');
    setApiMethod('GET');
    setApiParams([]);
    setApiHeaders([]);
    setApiBody('');
    setApiKey('');
    setApiKeyEdited(false);
    setHasApiKey(false);
    setShowApiKey(false);
  };

  const openNew = () => {
    setEditing('new');
    resetFields();
  };

  const openEdit = (tool: ToolSummary) => {
    setEditing(tool.id);
    setName(tool.name);
    setDescription(tool.description);
    setType(tool.type);
    setSheetUrl(tool.sheet_url ?? '');
    setApiUrl(tool.api_url ?? '');
    setApiMethod(tool.api_method === 'POST' ? 'POST' : 'GET');
    setApiParams(tool.api_params?.length ? tool.api_params : []);
    setApiHeaders(
      Object.entries(tool.api_headers ?? {}).map(([key, value]) => ({ key, value })),
    );
    setApiBody(tool.api_body ?? '');
    setApiKey('');
    setApiKeyEdited(false);
    setHasApiKey(tool.has_api_key);
    setShowApiKey(false);
  };

  const cancelEdit = () => {
    setEditing(null);
    resetFields();
  };

  const addParam = () => setApiParams((rows) => [...rows, emptyParam()]);
  const updateParam = (i: number, patch: Partial<ApiParamRow>) =>
    setApiParams((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeParam = (i: number) =>
    setApiParams((rows) => rows.filter((_, idx) => idx !== i));

  const addHeader = () => setApiHeaders((rows) => [...rows, emptyHeader()]);
  const updateHeader = (i: number, patch: Partial<HeaderRow>) =>
    setApiHeaders((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeHeader = (i: number) =>
    setApiHeaders((rows) => rows.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }
    if (type === 'google_sheet' && !sheetUrl.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }
    if (type === 'api' && !apiUrl.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }

    setSaving(true);
    try {
      const isNew = editing === 'new';
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        type,
      };
      if (type === 'google_sheet') {
        payload.sheet_url = sheetUrl.trim();
      } else {
        payload.api_url = apiUrl.trim();
        payload.api_method = apiMethod;
        payload.api_params = apiParams
          .map((p) => ({ name: p.name.trim(), description: p.description.trim(), required: p.required }))
          .filter((p) => p.name || p.description);
        payload.api_headers = Object.fromEntries(
          apiHeaders
            .map((h) => ({ key: h.key.trim(), value: h.value }))
            .filter((h) => h.key)
            .map((h) => [h.key, h.value]),
        );
        payload.api_body = apiBody.trim();
        if (apiKeyEdited) {
          payload.api_key = apiKey.trim() ? apiKey.trim() : null;
        }
      }

      const res = await fetch(isNew ? '/api/ai/tools' : `/api/ai/tools/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          (isNew ? t('saveSuccessNew') : t('saveSuccessUpdate')) +
            (data.name ? ` (${data.name})` : ''),
        );
        cancelEdit();
        await fetchTools();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/tools/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setTools((list) => list.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const toggleActive = async (tool: ToolSummary) => {
    const nextActive = !tool.is_active;
    setTools((list) =>
      list.map((x) => (x.id === tool.id ? { ...x, is_active: nextActive } : x)),
    );
    try {
      const res = await fetch(`/api/ai/tools/${tool.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? t('saveFailed'));
        await fetchTools();
      }
    } catch {
      toast.error(t('saveFailed'));
      await fetchTools();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {tools.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">{t('noTools')}</p>
            )}

            {tools.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {tools.map((tool) => (
                  <li
                    key={tool.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm text-foreground">{tool.name}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {tool.type === 'api' ? t('typeApi') : t('typeSheet')}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={tool.is_active}
                          onCheckedChange={() => void toggleActive(tool)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(tool)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(tool.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label>{t('type')}</Label>
                  <Select
                    value={type}
                    onValueChange={(v) => setType(v as ToolType)}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="google_sheet">{t('typeSheet')}</SelectItem>
                      <SelectItem value="api">{t('typeApi')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tool-name">{t('name')}</Label>
                  <Input
                    id="tool-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tool-description">{t('descriptionField')}</Label>
                  <Textarea
                    id="tool-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                    rows={3}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">{t('descriptionHint')}</p>
                </div>

                {type === 'google_sheet' ? (
                  <div className="space-y-2">
                    <Label htmlFor="tool-sheet-url">{t('sheetUrl')}</Label>
                    <Input
                      id="tool-sheet-url"
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      placeholder={t('sheetUrlPlaceholder')}
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">{t('sheetUrlHint')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <Label htmlFor="tool-api-url">{t('apiUrl')}</Label>
                        <Input
                          id="tool-api-url"
                          value={apiUrl}
                          onChange={(e) => setApiUrl(e.target.value)}
                          placeholder={t('apiUrlPlaceholder')}
                          disabled={saving}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('apiMethod')}</Label>
                        <Select
                          value={apiMethod}
                          onValueChange={(v) => setApiMethod(v as 'GET' | 'POST')}
                          disabled={saving}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="GET">GET</SelectItem>
                            <SelectItem value="POST">POST</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('apiUrlHint')}</p>

                    {apiMethod === 'POST' && (
                      <div className="space-y-2">
                        <Label htmlFor="tool-api-body">{t('apiBody')}</Label>
                        <Textarea
                          id="tool-api-body"
                          value={apiBody}
                          onChange={(e) => setApiBody(e.target.value)}
                          placeholder={t('apiBodyPlaceholder')}
                          rows={2}
                          disabled={saving}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>{t('apiParams')}</Label>
                      <p className="text-xs text-muted-foreground">{t('apiParamsHint')}</p>
                      {apiParams.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <Input
                            value={p.name}
                            onChange={(e) => updateParam(i, { name: e.target.value })}
                            placeholder={t('apiParamName')}
                            disabled={saving}
                            className="w-32"
                          />
                          <Input
                            value={p.description}
                            onChange={(e) => updateParam(i, { description: e.target.value })}
                            placeholder={t('apiParamDescription')}
                            disabled={saving}
                            className="min-w-0 flex-1"
                          />
                          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <Checkbox
                              checked={p.required}
                              onCheckedChange={(checked) =>
                                updateParam(i, { required: checked === true })
                              }
                              disabled={saving}
                            />
                            {t('apiParamRequired')}
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeParam(i)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={addParam} disabled={saving}>
                        <Plus className="mr-2 h-4 w-4" /> {t('addParam')}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('apiHeaders')}</Label>
                      {apiHeaders.map((h, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={h.key}
                            onChange={(e) => updateHeader(i, { key: e.target.value })}
                            placeholder={t('apiHeaderName')}
                            disabled={saving}
                            className="w-40"
                          />
                          <Input
                            value={h.value}
                            onChange={(e) => updateHeader(i, { value: e.target.value })}
                            placeholder={t('apiHeaderValue')}
                            disabled={saving}
                            className="min-w-0 flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeHeader(i)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={addHeader} disabled={saving}>
                        <Plus className="mr-2 h-4 w-4" /> {t('addHeader')}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tool-api-key">{t('apiKey')}</Label>
                      <div className="relative">
                        <Input
                          id="tool-api-key"
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => {
                            setApiKey(e.target.value);
                            setApiKeyEdited(true);
                          }}
                          onFocus={() => {
                            if (!apiKeyEdited && hasApiKey) {
                              setApiKey('');
                              setApiKeyEdited(true);
                            }
                          }}
                          placeholder={hasApiKey ? t('apiKeyStoredPlaceholder') : t('apiKeyPlaceholder')}
                          disabled={saving}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((s) => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('saveTool')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> {t('addTool')}
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
