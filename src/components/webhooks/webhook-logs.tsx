"use client";

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw, Play, CheckCircle, XCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WebhookLog {
  id: string;
  workflow_name: string;
  status: 'success' | 'failed' | 'no_match';
  created_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  error_message?: string | null;
  payload?: unknown;
}

export function WebhookLogs() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpandLog = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle className="h-3 w-3" />
            Success
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/20">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'no_match':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground border border-border">
            <AlertCircle className="h-3 w-3" />
            No Match
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Execution Logs</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            View history of webhook trigger execution results and diagnostic payloads.
          </p>
        </div>

        <Button
          onClick={fetchLogs}
          variant="outline"
          disabled={loading}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center bg-muted/20">
          <Play className="h-10 w-10 text-muted-foreground" />
          <h4 className="mt-4 text-sm font-semibold text-foreground">No Logs Found</h4>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Webhook triggers will log execution details here when payloads hit your workflow URL.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Workflow Name</th>
                  <th className="px-6 py-3">Customer Phone</th>
                  <th className="px-6 py-3">Customer Name</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs text-foreground">
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-[11px] text-muted-foreground">
                          {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                        </td>
                        <td className="px-6 py-4 font-medium text-foreground">{log.workflow_name}</td>
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-muted-foreground">{log.customer_phone || '—'}</td>
                        <td className="px-6 py-4 text-muted-foreground">{log.customer_name || '—'}</td>
                        <td className="whitespace-nowrap px-6 py-4">{getStatusBadge(log.status)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Button
                            onClick={() => toggleExpandLog(log.id)}
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground px-2 py-1 text-[11px] h-7 flex items-center gap-1 ml-auto"
                          >
                            {isExpanded ? (
                              <><EyeOff className="h-3.5 w-3.5" /> Hide Details</>
                            ) : (
                              <><Eye className="h-3.5 w-3.5" /> View Details</>
                            )}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-muted/20 px-6 py-4 border-t border-b border-border">
                            <div className="space-y-3">
                              {log.error_message && (
                                <div className="rounded border border-red-500/20 bg-red-500/5 p-3">
                                  <span className="text-[11px] font-bold text-red-500 dark:text-red-400 block uppercase tracking-wide">Error Message</span>
                                  <p className="mt-1 text-xs text-red-600 dark:text-red-300">{log.error_message}</p>
                                </div>
                              )}
                              <div>
                                <span className="text-[11px] font-bold text-muted-foreground block uppercase tracking-wide mb-1 font-mono">Payload JSON</span>
                                <pre className="max-h-60 overflow-y-auto rounded bg-muted p-3 text-[10px] font-mono text-foreground border border-border">
                                  {JSON.stringify(log.payload, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// React import helper inside component file for Next.js compile safety
import React from 'react';
