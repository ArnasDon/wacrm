"use client";

import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, X, Info, Paperclip, Upload, Loader2, ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { createClient } from '@/lib/supabase/client';
import { extractJsonPaths, getNestedValue, type WebhookCondition } from '@/lib/generic-webhooks/utils';

import type { MessageTemplate } from '@/types';

export interface WebhookWorkflow {
  id?: string;
  name: string;
  is_active: boolean;
  recipient_name_field: string;
  recipient_phone_field: string;
  recipient_email_field: string | null;
  create_contacts: boolean;
  conditions?: {
    matchType?: 'all' | 'any';
    rules?: WebhookCondition[];
  } | null;
  actions?: {
    type: string;
    template_name: string;
    language?: string;
    mappings?: {
      body?: { type: 'payload' | 'static' | 'upload'; value: string }[];
      headerText?: { type: 'payload' | 'static' | 'upload'; value: string };
      headerMedia?: { type: 'payload' | 'static' | 'upload'; value: string; filename?: string | null };
      buttons?: Record<string, { type: 'payload' | 'static' | 'upload'; value: string }>;
    };
  }[] | null;
}

interface EditWorkflowModalProps {
  workflow: WebhookWorkflow | null; // Null if creating a new workflow
  lastPayload: Record<string, unknown> | null;
  onClose: () => void;
  onSave: () => void;
}

export function EditWorkflowModal({ workflow, lastPayload, onClose, onSave }: EditWorkflowModalProps) {
  const isEditing = !!workflow;
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [recipientNameField, setRecipientNameField] = useState('');
  const [recipientPhoneField, setRecipientPhoneField] = useState('');
  const [recipientEmailField, setRecipientEmailField] = useState('');
  const [createContacts, setCreateContacts] = useState(true);
  
  // Conditions
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<WebhookCondition[]>([]);

  // Templates & Action
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [bodyMappings, setBodyMappings] = useState<{ index: number; type: 'payload' | 'static' | 'upload'; value: string }[]>([]); // [{ index: 1, type: 'payload', value: '' }]
  const [headerMapping, setHeaderMapping] = useState<{ type: 'payload' | 'static' | 'upload'; value: string } | null>(null); // { type: 'payload', value: '' }

  // Sub tabs state
  const [activeSubTab, setActiveSubTab] = useState<'map' | 'media' | 'advance'>('map');

  // Media Mapping fields
  const [mediaSourceType, setMediaSourceType] = useState<'static' | 'payload' | 'upload'>('static');
  const [mediaFileName, setMediaFileName] = useState('');
  const [mediaLink, setMediaLink] = useState('');
  const [mediaPayloadPath, setMediaPayloadPath] = useState('');
  const [mediaUploadUrl, setMediaUploadUrl] = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Button mapping (for Advance tab)
  const [buttonMappings, setButtonMappings] = useState<Record<number, { type: 'static' | 'payload' | 'upload', value: string }>>({});

  const [saving, setSaving] = useState(false);

  const supabase = createClient();
  const availablePaths = lastPayload ? extractJsonPaths(lastPayload) : [];

  useEffect(() => {
    // Load approved templates
    async function loadTemplates() {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('name');
      setTemplates(data || []);
    }
    loadTemplates();

    if (workflow) {
      setName(workflow.name);
      setIsActive(workflow.is_active);
      setRecipientNameField(workflow.recipient_name_field);
      setRecipientPhoneField(workflow.recipient_phone_field);
      setRecipientEmailField(workflow.recipient_email_field || '');
      setCreateContacts(workflow.create_contacts !== false);

      const condsObj = workflow.conditions || {};
      setMatchType(condsObj.matchType === 'any' ? 'any' : 'all');
      setConditions(Array.isArray(condsObj.rules) ? condsObj.rules : []);

      const actionsList = workflow.actions || [];
      const templateAct = actionsList.find((a) => a.type === 'send_template');
      if (templateAct) {
        // Find template by name
        setSelectedTemplateId(templateAct.template_name || '');
        
        // Load mappings
        const bodyM = templateAct.mappings?.body || [];
        setBodyMappings(
          bodyM.map((m, idx: number) => ({
            index: idx + 1,
            type: m.type || 'payload',
            value: m.value || ''
          }))
        );

        if (templateAct.mappings?.headerText) {
          setHeaderMapping({
            type: templateAct.mappings.headerText.type || 'payload',
            value: templateAct.mappings.headerText.value || ''
          });
        }

        // Load media mapping
        const headerMedia = templateAct.mappings?.headerMedia;
        if (headerMedia) {
          setMediaSourceType(headerMedia.type || 'static');
          setMediaFileName(headerMedia.filename || '');
          if (headerMedia.type === 'payload') {
            setMediaPayloadPath(headerMedia.value || '');
          } else if (headerMedia.type === 'upload') {
            setMediaUploadUrl(headerMedia.value || '');
          } else {
            setMediaLink(headerMedia.value || '');
          }
        }

        // Load button mappings
        const buttonsMap = templateAct.mappings?.buttons || {};
        const bMappings: Record<number, { type: 'static' | 'payload' | 'upload', value: string }> = {};
        for (const key in buttonsMap) {
          const idx = parseInt(key, 10);
          if (!isNaN(idx)) {
            bMappings[idx] = {
              type: buttonsMap[key].type || 'static',
              value: buttonsMap[key].value || ''
            };
          }
        }
        setButtonMappings(bMappings);
      }
    }
  }, [workflow, supabase]);

  // Extracts variable indices like {{1}}, {{2}} from body text
  const parseTemplateVariables = (bodyText: string): number[] => {
    const regex = /\{\{(\d+)\}\}/g;
    const indices: number[] = [];
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
      const idx = parseInt(match[1]);
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.sort((a, b) => a - b);
  };

  const handleTemplateChange = (templateName: string) => {
    setSelectedTemplateId(templateName);
    const tmpl = templates.find((t) => t.name === templateName);
    if (!tmpl) {
      setBodyMappings([]);
      setHeaderMapping(null);
      return;
    }

    // Body variables
    const vars = parseTemplateVariables(tmpl.body_text);
    setBodyMappings(
      vars.map((v) => ({
        index: v,
        type: 'payload',
        value: ''
      }))
    );

    // Header variable check
    if (tmpl.header_type === 'text' && tmpl.header_content?.includes('{{1}}')) {
      setHeaderMapping({ type: 'payload', value: '' });
    } else {
      setHeaderMapping(null);
    }

    // Reset media mapping & buttons
    setActiveSubTab('map');
    setMediaSourceType('static');
    setMediaFileName('');
    setMediaLink('');
    setMediaPayloadPath('');
    setMediaUploadUrl('');

    const bMappings: Record<number, { type: 'static' | 'payload', value: string }> = {};
    if (tmpl.buttons && Array.isArray(tmpl.buttons)) {
      tmpl.buttons.forEach((_, idx: number) => {
        bMappings[idx] = { type: 'static', value: '' };
      });
    }
    setButtonMappings(bMappings);
  };

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: 'equals', value: '' }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, fieldKey: keyof WebhookCondition, val: string) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [fieldKey]: val } as WebhookCondition;
    setConditions(updated);
  };

  const updateBodyMapping = (index: number, key: 'type' | 'value', val: string) => {
    setBodyMappings(
      bodyMappings.map((m) => (m.index === index ? { ...m, [key]: val } : m))
    );
  };

  const updateButtonMapping = (idx: number, key: 'type' | 'value', val: string) => {
    setButtonMappings(prev => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        [key]: val
      }
    }));
  };

  const handleMediaUpload = async (file: File) => {
    const headerType = selectedTmpl?.header_type || 'image';
    if (headerType === 'image') {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Unsupported image type. Use PNG, JPG, or JPEG.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image is too large. Maximum 5 MB.');
        return;
      }
    } else if (headerType === 'video') {
      const allowedTypes = ['video/mp4'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Unsupported video type. Use MP4.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Video is too large. Maximum 10 MB.');
        return;
      }
    } else if (headerType === 'document') {
      const allowedTypes = ['application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Unsupported document type. Use PDF.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Document is too large. Maximum 10 MB.');
        return;
      }
    }
    setMediaUploading(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error('Not signed in.');

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profileErr || !profile?.account_id) {
        throw new Error('Could not resolve your account.');
      }

      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'file';
      const path = `account-${profile.account_id}/${Date.now()}-${safeBase}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('flow-media')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      if (upErr) throw new Error(upErr.message);

      const { data: { publicUrl } } = supabase.storage.from('flow-media').getPublicUrl(path);
      setMediaUploadUrl(publicUrl);
      setMediaFileName(file.name);
      toast.success('File uploaded successfully.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setMediaUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name) {
      toast.error('Workflow Name is required.');
      return;
    }
    if (!recipientPhoneField) {
      toast.error('Recipient Phone Mapping is required.');
      return;
    }
    if (!recipientNameField) {
      toast.error('Recipient Name Mapping is required.');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Please select a template action.');
      return;
    }

    setSaving(true);
    try {
      const selectedTmpl = templates.find((t) => t.name === selectedTemplateId);
      
      const payloadData = {
        name,
        is_active: isActive,
        recipient_name_field: recipientNameField,
        recipient_phone_field: recipientPhoneField,
        recipient_email_field: recipientEmailField || null,
        create_contacts: createContacts,
        conditions: {
          matchType,
          rules: conditions
        },
        actions: [
          {
            type: 'send_template',
            template_name: selectedTemplateId,
            language: selectedTmpl?.language || 'en_US',
            mappings: {
              body: bodyMappings.map((m) => ({ type: m.type, value: m.value })),
              headerText: headerMapping ? { type: headerMapping.type, value: headerMapping.value } : null,
              headerMedia: ['image', 'video', 'document'].includes(selectedTmpl?.header_type || '') ? {
                type: mediaSourceType,
                filename: mediaFileName || null,
                value: mediaSourceType === 'payload'
                  ? mediaPayloadPath
                  : mediaSourceType === 'upload'
                  ? mediaUploadUrl
                  : mediaLink
              } : null,
              buttons: selectedTmpl?.buttons?.length ? Object.fromEntries(
                selectedTmpl.buttons.map((btn, idx: number) => [
                  idx,
                  {
                    type: buttonMappings[idx]?.type || 'static',
                    value: buttonMappings[idx]?.value || ''
                  }
                ])
              ) : null
            }
          }
        ]
      };

      const url = isEditing ? `/api/webhooks/workflows/${workflow.id}` : '/api/webhooks/workflows';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadData)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save workflow');
      }

      toast.success(isEditing ? 'Workflow updated.' : 'Workflow created.');
      onSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const selectedTmpl = templates.find((t) => t.name === selectedTemplateId);

  const getSubstitutedText = (text: string, mappings: { index: number; type: string; value: string }[]) => {
    if (!text) return '';
    return text.replace(/\{\{(\d+)\}\}/g, (_, numStr) => {
      const index = parseInt(numStr, 10);
      const mapping = mappings.find((m) => m.index === index);
      if (!mapping) return `{{${numStr}}}`;
      if (mapping.type === 'static') {
        const val = mapping.value || '';
        // Substitute variables inside static text e.g. {{customer.name}}
        return val.replace(/\{\{([^}]+)\}\}/g, (__: string, path: string) => {
          if (lastPayload) {
            const resolvedVal = getNestedValue(lastPayload, path.trim());
            if (resolvedVal !== undefined && resolvedVal !== null) return String(resolvedVal);
          }
          return `[${path}]`;
        });
      }
      if (mapping.value) {
        if (lastPayload) {
          const val = getNestedValue(lastPayload, mapping.value);
          if (val !== undefined && val !== null) return String(val);
        }
        return `[${mapping.value}]`;
      }
      return `{{${numStr}}}`;
    });
  };

  const getSubstitutedHeader = (headerText: string, mapping: { type: string; value: string } | null) => {
    if (!headerText) return '';
    if (!mapping) return headerText;
    return headerText.replace(/\{\{1\}\}/g, () => {
      if (mapping.type === 'static') {
        const val = mapping.value || '';
        return val.replace(/\{\{([^}]+)\}\}/g, (__: string, path: string) => {
          if (lastPayload) {
            const resolvedVal = getNestedValue(lastPayload, path.trim());
            if (resolvedVal !== undefined && resolvedVal !== null) return String(resolvedVal);
          }
          return `[${path}]`;
        });
      }
      if (mapping.value) {
        if (lastPayload) {
          const val = getNestedValue(lastPayload, mapping.value);
          if (val !== undefined && val !== null) return String(val);
        }
        return `[${mapping.value}]`;
      }
      return '{{1}}';
    });
  };

  return (
    <div className="flex w-full flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
      {/* Form Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white p-1.5 flex items-center justify-center transition-colors"
            title="Back to list"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {isEditing ? `Edit Workflow: ${workflow.name}` : 'Create New Workflow'}
          </h3>
        </div>
      </div>

      {/* Form Body */}
      <div className="px-6 py-6 space-y-6">
          {/* General Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Workflow Name *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lead Alert Notification"
                  className="mt-1 bg-white dark:bg-slate-950 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 focus:border-primary"
                />
              </div>

              <div className="flex flex-col items-end pt-5">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">Is Active</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Recipient Name Mapping *</label>
                <select
                  value={recipientNameField}
                  onChange={(e) => setRecipientNameField(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select payload path...</option>
                  {availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Recipient Phone Mapping *</label>
                <select
                  value={recipientPhoneField}
                  onChange={(e) => setRecipientPhoneField(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select payload path...</option>
                  {availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Recipient Email Mapping</label>
                <select
                  value={recipientEmailField}
                  onChange={(e) => setRecipientEmailField(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select payload path (optional)...</option>
                  {availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-955/30 border border-slate-200 dark:border-slate-800/80 p-3.5 mt-2">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold text-slate-900 dark:text-white">Save incoming webhooks as contacts</label>
                <p className="text-[11px] text-slate-655 dark:text-slate-400">
                  If enabled, unrecognized phone numbers are saved to the database. Existing contacts are never duplicated.
                </p>
              </div>
              <Switch checked={createContacts} onCheckedChange={setCreateContacts} />
            </div>
          </div>

          {/* Conditions Section */}
          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Conditions</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Determine if the payload triggers this workflow.</p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as 'all' | 'any')}
                  className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none"
                >
                  <option value="all">Match All Conditions</option>
                  <option value="any">Match Any Condition</option>
                </select>

                <Button
                  onClick={addCondition}
                  variant="outline"
                  size="sm"
                  className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 text-xs py-1 px-2.5 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Condition
                </Button>
              </div>
            </div>

            {conditions.length > 0 ? (
              <div className="space-y-3">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-955/40 border border-slate-200 dark:border-slate-800/60 p-3">
                    <select
                      value={cond.field}
                      onChange={(e) => updateCondition(idx, 'field', e.target.value)}
                      className="flex-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="">Select path...</option>
                      {availablePaths.map((path) => (
                        <option key={path} value={path}>{path}</option>
                      ))}
                    </select>

                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(idx, 'operator', e.target.value as WebhookCondition['operator'])}
                      className="w-36 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="equals">Equals</option>
                      <option value="not_equals">Does not equal</option>
                      <option value="contains">Contains</option>
                      <option value="not_contains">Does not contain</option>
                      <option value="exists">Exists</option>
                      <option value="not_exists">Does not exist</option>
                    </select>

                    {!['exists', 'not_exists'].includes(cond.operator) && (
                      <Input
                        value={cond.value}
                        onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                        placeholder="Compare value"
                        className="w-36 bg-white dark:bg-slate-950 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                      />
                    )}

                    <Button
                      onClick={() => removeCondition(idx)}
                      variant="ghost"
                      size="icon"
                      className="text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 shrink-0 h-8 w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-955/10 text-center">
                <span className="text-xs text-slate-500 font-medium">No conditions configured. Trigger on any payload.</span>
              </div>
            )}
          </div>

          {/* Actions / Template Mapping */}
          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-6 space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Action: Send Template</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Choose which WhatsApp Template to send and map its variables.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">WhatsApp Template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
              </div>

              {selectedTmpl && (() => {
                const hasMediaHeader = ['image', 'video', 'document'].includes(selectedTmpl.header_type || '');
                const hasButtons = !!(selectedTmpl.buttons && selectedTmpl.buttons.length > 0);

                let previewImageUrl = '';
                if (selectedTmpl.header_type === 'image') {
                  if (mediaSourceType === 'upload' && mediaUploadUrl) {
                    previewImageUrl = mediaUploadUrl;
                  } else if (mediaSourceType === 'static' && mediaLink) {
                    previewImageUrl = mediaLink;
                  } else if (mediaSourceType === 'payload' && mediaPayloadPath) {
                    if (lastPayload) {
                      const val = getNestedValue(lastPayload, mediaPayloadPath);
                      if (val && typeof val === 'string' && val.startsWith('http')) {
                        previewImageUrl = val;
                      }
                    }
                  }
                  if (!previewImageUrl && selectedTmpl.header_media_url) {
                    previewImageUrl = selectedTmpl.header_media_url;
                  }
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1.8fr] gap-6 border-t border-slate-200 dark:border-slate-800 pt-6">
                    {/* Left Column: Live WhatsApp Preview */}
                    <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950 p-5 shadow-inner select-none h-fit min-h-[380px]">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-900 pb-2.5 mb-4">
                        <span>Live Preview</span>
                        <span className="text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-mono">Simulated WhatsApp</span>
                      </div>

                      <div className="flex flex-col border border-slate-200 dark:border-slate-900/60 rounded-xl bg-white dark:bg-slate-950 p-4 min-h-[300px] relative overflow-hidden bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] justify-between">
                        {/* Chat Body */}
                        <div className="space-y-4 flex-1 flex flex-col justify-start">
                          {/* Chat bubble header context */}
                          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-900/60 pb-2 mb-2 bg-white/80 dark:bg-slate-955/80 backdrop-blur-sm sticky top-0 z-10">
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">JT</div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-semibold text-slate-900 dark:text-white truncate">Journey Tank Bot</div>
                              <div className="text-[9px] text-slate-500">Business Account</div>
                            </div>
                          </div>

                          {/* Message Bubble */}
                          <div className="max-w-[90%] self-start rounded-r-xl rounded-bl-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 text-slate-900 dark:text-white p-3 shadow-md space-y-2 relative">
                            {/* Header Media Image Preview */}
                            {selectedTmpl.header_type === 'image' && (
                              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-200/50 dark:bg-slate-950/80 aspect-video flex items-center justify-center relative">
                                {previewImageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={previewImageUrl}
                                    alt="Header preview"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-1.5 text-slate-550 dark:text-slate-500 p-4">
                                    <ImageIcon className="h-5 w-5" />
                                    <span className="text-[10px]">No image mapped</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Header Text Preview */}
                            {selectedTmpl.header_type === 'text' && selectedTmpl.header_content && (
                              <div className="text-xs font-bold text-slate-900 dark:text-white tracking-wide border-b border-slate-200 dark:border-slate-800 pb-1">
                                {getSubstitutedHeader(selectedTmpl.header_content, headerMapping)}
                              </div>
                            )}

                            {/* Body Text Preview */}
                            <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                              {getSubstitutedText(selectedTmpl.body_text, bodyMappings)}
                            </div>

                            {/* Footer text */}
                            {selectedTmpl.footer_text && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium pt-0.5">
                                {selectedTmpl.footer_text}
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className="text-[9px] text-slate-450 dark:text-slate-500 text-right mt-1 font-mono">
                              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>

                          {/* Interactive Buttons Preview */}
                          {hasButtons && (
                            <div className="max-w-[90%] self-start w-full mt-1.5 space-y-1.5">
                              {selectedTmpl.buttons?.map((btn: import('@/types').TemplateButton, idx: number) => {
                                const btnMapping = buttonMappings[idx];
                                let payloadPreview = '';
                                if (btnMapping) {
                                  payloadPreview = btnMapping.type === 'static'
                                    ? btnMapping.value
                                    : btnMapping.value
                                    ? `[payload: ${btnMapping.value}]`
                                    : '';
                                }

                                return (
                                  <div
                                    key={idx}
                                    className="rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-4 py-2 text-center text-xs font-semibold text-primary/90 hover:bg-slate-200/50 dark:hover:bg-slate-850 cursor-pointer shadow-sm transition-colors"
                                  >
                                    {btn.text}
                                    {payloadPreview && (
                                      <span className="block text-[8px] text-slate-500 font-mono mt-0.5 truncate">
                                        {`Payload: ${payloadPreview}`}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Tabbed Configurations */}
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-955/60 border border-slate-200 dark:border-slate-800 p-4 space-y-4 h-fit">
                      {/* Tab Navigation */}
                      <div className="flex border-b border-slate-200 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setActiveSubTab('map')}
                          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                            activeSubTab === 'map'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          Map
                        </button>
                        <button
                          type="button"
                          disabled={!hasMediaHeader}
                          onClick={() => setActiveSubTab('media')}
                          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                            !hasMediaHeader
                              ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-655 border-transparent'
                              : activeSubTab === 'media'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                          title={!hasMediaHeader ? "Template does not have a media header" : "Configure template media"}
                        >
                          Media
                        </button>
                        <button
                          type="button"
                          disabled={!hasButtons}
                          onClick={() => setActiveSubTab('advance')}
                          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                            !hasButtons
                              ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-655 border-transparent'
                              : activeSubTab === 'advance'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                          title={!hasButtons ? "Template does not have buttons" : "Configure button payloads"}
                        >
                          Advance
                        </button>
                      </div>

                      {/* Map Tab Content */}
                      {activeSubTab === 'map' && (
                        <div className="space-y-4">
                          {/* Header parameters */}
                          {headerMapping && (
                            <div className="space-y-2 border-t border-slate-200 dark:border-slate-900 pt-3">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-550 dark:text-slate-400">
                                <Info className="h-3.5 w-3.5" />
                                <span>Header Text Parameter</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={headerMapping.type}
                                  onChange={(e) => setHeaderMapping({ ...headerMapping, type: e.target.value as 'payload' | 'static' | 'upload' })}
                                  className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none w-36"
                                >
                                  <option value="payload">Payload Field</option>
                                  <option value="static">Static Text</option>
                                </select>
                                {headerMapping.type === 'payload' ? (
                                  <select
                                    value={headerMapping.value}
                                    onChange={(e) => setHeaderMapping({ ...headerMapping, value: e.target.value })}
                                    className="flex-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                                  >
                                    <option value="">Select path...</option>
                                    {availablePaths.map((path) => (
                                      <option key={path} value={path}>{path}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="flex-1 flex gap-2 items-center">
                                    <Input
                                      id="header-static-input"
                                      value={headerMapping.value}
                                      onChange={(e) => setHeaderMapping({ ...headerMapping, value: e.target.value })}
                                      placeholder="Static text (use {{path}} for variables)"
                                      className="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                                    />
                                    <select
                                      onChange={(e) => {
                                        const path = e.target.value;
                                        if (path) {
                                          const inputEl = document.getElementById("header-static-input") as HTMLInputElement;
                                          const insertText = `{{${path}}}`;
                                          let newValue = headerMapping.value;
                                          if (inputEl) {
                                            const start = inputEl.selectionStart ?? newValue.length;
                                            const end = inputEl.selectionEnd ?? newValue.length;
                                            newValue = newValue.substring(0, start) + insertText + newValue.substring(end);
                                            setTimeout(() => {
                                              inputEl.focus();
                                              inputEl.setSelectionRange(start + insertText.length, start + insertText.length);
                                            }, 0);
                                          } else {
                                            newValue += insertText;
                                          }
                                          setHeaderMapping({ ...headerMapping, value: newValue });
                                          e.target.value = ''; // Reset select
                                        }
                                      }}
                                      className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer w-28 h-8 text-slate-900 dark:text-white"
                                    >
                                      <option value="">+ Variable</option>
                                      {availablePaths.map((path) => (
                                        <option key={path} value={path}>{path}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Body parameters */}
                          {bodyMappings.length > 0 && (
                            <div className="space-y-3 border-t border-slate-200 dark:border-slate-900 pt-3">
                              <span className="text-xs font-semibold text-slate-550 dark:text-slate-400 block">Body Parameters Variables</span>
                              {bodyMappings.map((m) => (
                                <div key={m.index} className="flex items-center gap-2">
                                  <span className="w-12 text-xs font-mono font-bold text-slate-500">{`{{${m.index}}}`}</span>
                                  <select
                                    value={m.type}
                                    onChange={(e) => updateBodyMapping(m.index, 'type', e.target.value)}
                                    className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none w-36"
                                  >
                                    <option value="payload">Payload Field</option>
                                    <option value="static">Static Text</option>
                                  </select>
                                  {m.type === 'payload' ? (
                                    <select
                                      value={m.value}
                                      onChange={(e) => updateBodyMapping(m.index, 'value', e.target.value)}
                                      className="flex-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                                    >
                                      <option value="">Select path...</option>
                                      {availablePaths.map((path) => (
                                        <option key={path} value={path}>{path}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="flex-1 flex gap-2 items-center">
                                      <Input
                                        id={`body-static-input-${m.index}`}
                                        value={m.value}
                                        onChange={(e) => updateBodyMapping(m.index, 'value', e.target.value)}
                                        placeholder="Static text (use {{path}} for variables)"
                                        className="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                                      />
                                      <select
                                        onChange={(e) => {
                                          const path = e.target.value;
                                          if (path) {
                                            const inputEl = document.getElementById(`body-static-input-${m.index}`) as HTMLInputElement;
                                            const insertText = `{{${path}}}`;
                                            let newValue = m.value;
                                            if (inputEl) {
                                              const start = inputEl.selectionStart ?? newValue.length;
                                              const end = inputEl.selectionEnd ?? newValue.length;
                                              newValue = newValue.substring(0, start) + insertText + newValue.substring(end);
                                              setTimeout(() => {
                                                inputEl.focus();
                                                inputEl.setSelectionRange(start + insertText.length, start + insertText.length);
                                              }, 0);
                                            } else {
                                              newValue += insertText;
                                            }
                                            updateBodyMapping(m.index, 'value', newValue);
                                            e.target.value = ''; // Reset select
                                          }
                                        }}
                                        className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer w-28 h-8 text-slate-900 dark:text-white"
                                      >
                                        <option value="">+ Variable</option>
                                        {availablePaths.map((path) => (
                                          <option key={path} value={path}>{path}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Media Tab Content */}
                      {activeSubTab === 'media' && hasMediaHeader && (
                        <div className="space-y-4">
                          <p className="text-xs text-slate-655 dark:text-slate-400 leading-relaxed">
                            You can personalise this template with new media (images, videos, or PDFs) or we will use the existing ones you uploaded as sample by default.
                          </p>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">File name</label>
                            <Input
                              value={mediaFileName}
                              onChange={(e) => setMediaFileName(e.target.value)}
                              placeholder="e.g. image.jpg"
                              className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Media Source</label>
                            <select
                              value={mediaSourceType}
                              onChange={(e) => setMediaSourceType(e.target.value as 'static' | 'payload' | 'upload')}
                              className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                            >
                              <option value="static">Paste a link (Static URL)</option>
                              <option value="payload">Pick variable (Payload Field)</option>
                              <option value="upload">Upload media file</option>
                            </select>
                          </div>

                          {mediaSourceType === 'static' && (
                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Paste a link</label>
                              <Input
                                value={mediaLink}
                                onChange={(e) => setMediaLink(e.target.value)}
                                placeholder={
                                  selectedTmpl.header_type === 'video'
                                    ? "https://example.com/video.mp4"
                                    : selectedTmpl.header_type === 'document'
                                    ? "https://example.com/document.pdf"
                                    : "https://example.com/image.jpg"
                                }
                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                              />
                            </div>
                          )}

                          {mediaSourceType === 'payload' && (
                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Pick variable</label>
                              <select
                                value={mediaPayloadPath}
                                onChange={(e) => setMediaPayloadPath(e.target.value)}
                                className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-primary focus:outline-none"
                              >
                                <option value="">Select payload path...</option>
                                  {availablePaths.map((path) => (
                                    <option key={path} value={path}>{path}</option>
                                  ))}
                              </select>
                            </div>
                          )}

                          {mediaSourceType === 'upload' && (
                            <div className="space-y-2">
                              <label className="block text-xs font-semibold text-slate-550 dark:text-slate-400">Upload</label>
                              {mediaUploadUrl ? (
                                <div className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs">
                                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-cyan-550 dark:text-cyan-400" />
                                  <a
                                    href={mediaUploadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-300 font-medium"
                                  >
                                    {mediaFileName || mediaUploadUrl}
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => { setMediaUploadUrl(''); setMediaFileName(''); }}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={mediaUploading}
                                  onClick={() => fileInputRef.current?.click()}
                                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-4 text-xs text-slate-500 dark:text-slate-400 transition-colors hover:border-slate-400 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {mediaUploading ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      Uploading...
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="h-3.5 w-3.5" />
                                      {`Click to upload ${selectedTmpl.header_type}`}
                                    </>
                                  )}
                                </button>
                              )}
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept={
                                  selectedTmpl.header_type === 'video'
                                    ? "video/mp4"
                                    : selectedTmpl.header_type === 'document'
                                    ? "application/pdf"
                                    : "image/png,image/jpeg,image/jpg"
                                }
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void handleMediaUpload(f);
                                  e.target.value = '';
                                }}
                              />
                              <p className="text-[10px] text-slate-500 font-medium leading-normal">
                                {selectedTmpl.header_type === 'video'
                                  ? "(Allowed file types: .mp4. Max file size: 10 MB)"
                                  : selectedTmpl.header_type === 'document'
                                  ? "(Allowed file types: .pdf. Max file size: 10 MB)"
                                  : "(Allowed file types: .jpeg, .jpg, .png. Max file size: 5 MB)"}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Advance Tab Content */}
                      {activeSubTab === 'advance' && hasButtons && (
                        <div className="space-y-4">
                          <div>
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-350 block mb-1">Button Payloads</span>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                              In your WhatsApp Templates, if you&apos;ve incorporated buttons, the payload serves as a trigger or intent for a flow, activating the flow upon selection.
                            </p>
                          </div>

                          <div className="space-y-3">
                            {selectedTmpl.buttons?.map((btn: import('@/types').TemplateButton, idx: number) => (
                              <div key={idx} className="space-y-1.5 p-3 rounded-lg bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/85">
                                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                                  <span>{`Button ${idx + 1}: "${btn.text}" (${btn.type})`}</span>
                                  <span className="text-[10px] text-slate-450 dark:text-slate-500 uppercase">Optional</span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <select
                                    value={buttonMappings[idx]?.type || 'static'}
                                    onChange={(e) => updateButtonMapping(idx, 'type', e.target.value as 'static' | 'payload')}
                                    className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none w-36"
                                  >
                                    <option value="static">Static Text</option>
                                    <option value="payload">Payload Field</option>
                                  </select>
                                  {buttonMappings[idx]?.type === 'payload' ? (
                                    <select
                                      value={buttonMappings[idx]?.value || ''}
                                      onChange={(e) => updateButtonMapping(idx, 'value', e.target.value)}
                                      className="flex-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-905 px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                                    >
                                      <option value="">Select path...</option>
                                      {availablePaths.map((path) => (
                                        <option key={path} value={path}>{path}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="flex-1 flex gap-2 items-center">
                                      <Input
                                        id={`button-static-input-${idx}`}
                                        value={buttonMappings[idx]?.value || ''}
                                        onChange={(e) => updateButtonMapping(idx, 'value', e.target.value)}
                                        placeholder="Static payload value (use {{path}} for variables)"
                                        className="flex-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 py-1 h-8 text-xs focus:border-primary"
                                      />
                                      <select
                                        onChange={(e) => {
                                          const path = e.target.value;
                                          if (path) {
                                            const inputEl = document.getElementById(`button-static-input-${idx}`) as HTMLInputElement;
                                            const insertText = `{{${path}}}`;
                                            let newValue = buttonMappings[idx]?.value || '';
                                            if (inputEl) {
                                              const start = inputEl.selectionStart ?? newValue.length;
                                              const end = inputEl.selectionEnd ?? newValue.length;
                                              newValue = newValue.substring(0, start) + insertText + newValue.substring(end);
                                              setTimeout(() => {
                                                inputEl.focus();
                                                inputEl.setSelectionRange(start + insertText.length, start + insertText.length);
                                              }, 0);
                                            } else {
                                              newValue += insertText;
                                            }
                                            updateButtonMapping(idx, 'value', newValue);
                                            e.target.value = ''; // Reset select
                                          }
                                        }}
                                        className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-[10px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer w-28 h-8 text-slate-900 dark:text-white"
                                      >
                                        <option value="">+ Variable</option>
                                        {availablePaths.map((path) => (
                                          <option key={path} value={path}>{path}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Form Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-6 py-4">
          <Button
            onClick={onClose}
            variant="outline"
            className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/95 flex items-center gap-2"
          >
            {saving ? 'Saving...' : isEditing ? 'Update Workflow' : 'Create Workflow'}
          </Button>
        </div>
      </div>
  );
}
