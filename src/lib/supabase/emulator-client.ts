// Browser-safe emulator client that communicates with server endpoints.
// Contains zero dependencies on Node.js built-ins or server-side libraries (like mysql2, bcryptjs, jsonwebtoken, etc.).

export class EmulatorQueryBuilder {
  private tableName: string;
  private selectFields: string = '*';
  private conditions: { column: string; operator: string; value: any }[] = [];
  private orderColumns: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private offsetCount: number | null = null;
  private orFilter: string | null = null;
  private countOption: string | null = null;
  private singleResult: boolean = false;
  private maybeSingleResult: boolean = false;
  private isInsert: boolean = false;
  private isUpdate: boolean = false;
  private isDelete: boolean = false;
  private isUpsert: boolean = false;
  private dataToSet: any = null;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(fields: string = '*', options?: { count?: string; head?: boolean }) {
    this.selectFields = fields;
    if (options?.count) {
      this.countOption = options.count;
    }
    return this;
  }

  insert(data: any) {
    this.isInsert = true;
    this.dataToSet = data;
    return this;
  }

  upsert(data: any, options?: any) {
    this.isInsert = true;
    this.isUpsert = true;
    this.dataToSet = data;
    return this;
  }

  update(data: any) {
    this.isUpdate = true;
    this.dataToSet = data;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  eq(column: string, value: any) {
    this.conditions.push({ column, operator: '=', value });
    return this;
  }

  neq(column: string, value: any) {
    this.conditions.push({ column, operator: '!=', value });
    return this;
  }

  gt(column: string, value: any) {
    this.conditions.push({ column, operator: '>', value });
    return this;
  }

  gte(column: string, value: any) {
    this.conditions.push({ column, operator: '>=', value });
    return this;
  }

  lt(column: string, value: any) {
    this.conditions.push({ column, operator: '<', value });
    return this;
  }

  lte(column: string, value: any) {
    this.conditions.push({ column, operator: '<=', value });
    return this;
  }

  like(column: string, pattern: string) {
    this.conditions.push({ column, operator: 'LIKE', value: pattern });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.conditions.push({ column, operator: 'LIKE', value: pattern });
    return this;
  }

  in(column: string, values: any[]) {
    this.conditions.push({ column, operator: 'IN', value: values });
    return this;
  }

  is(column: string, value: any) {
    if (value === null) {
      this.conditions.push({ column, operator: 'IS NULL', value: null });
    } else {
      this.conditions.push({ column, operator: '=', value });
    }
    return this;
  }

  /** PostgREST-style negation, e.g. `.not('col', 'is', null)` → IS NOT NULL */
  not(column: string, operator: string, value: any) {
    if (operator === 'is' && value === null) {
      this.conditions.push({ column, operator: 'IS NOT NULL', value: null });
    } else if (operator === 'eq') {
      this.conditions.push({ column, operator: '!=', value });
    } else if (operator === 'in') {
      const values = Array.isArray(value) ? value : [value];
      this.conditions.push({ column, operator: 'NOT IN', value: values });
    } else {
      this.conditions.push({ column, operator: '!=', value });
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumns.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.offsetCount = from;
    this.limitCount = to - from + 1;
    return this;
  }

  or(filter: string) {
    this.orFilter = filter;
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  maybeSingle() {
    this.maybeSingleResult = true;
    return this;
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const res = await this.execute();
      if (onfulfilled) return onfulfilled(res);
      return res;
    } catch (err) {
      if (onrejected) return onrejected(err);
      throw err;
    }
  }

  private async execute() {
    // Browser side: Proxy to HTTP endpoint
    const response = await fetch('/api/db-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableName: this.tableName,
        selectFields: this.selectFields,
        conditions: this.conditions,
        orderColumns: this.orderColumns,
        limitCount: this.limitCount,
        offsetCount: this.offsetCount,
        orFilter: this.orFilter,
        countOption: this.countOption,
        singleResult: this.singleResult,
        maybeSingleResult: this.maybeSingleResult,
        isInsert: this.isInsert,
        isUpdate: this.isUpdate,
        isDelete: this.isDelete,
        isUpsert: this.isUpsert,
        dataToSet: this.dataToSet
      })
    });
    return await response.json();
  }
}

export function createEmulatorClient() {
  const authCallbacks: ((event: string, session: any) => void)[] = [];

  const triggerAuthChange = (event: string, session: any) => {
    authCallbacks.forEach(cb => {
      try {
        cb(event, session);
      } catch (e) {
        console.error(e);
      }
    });
  };

  const auth = {
    async getSession() {
      if (typeof window === 'undefined') {
        return { data: { session: null }, error: null };
      }
      try {
        const res = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
        }).catch(() => null);
        if (res && res.ok) {
          const payload = await res.json().catch(() => ({}));
          return { data: { session: payload.data?.session || null }, error: null };
        }
      } catch (e) {
        // Ignored
      }
      return { data: { session: null }, error: null };
    },

    async getUser() {
      const { data, error } = await this.getSession();
      return { data: { user: data?.session?.user || null }, error };
    },

    async signInWithPassword({ email, password }: any) {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const payload = await res.json();
      if (res.ok && payload.data?.session) {
        triggerAuthChange('SIGNED_IN', payload.data.session);
      }
      if (payload.data?.needsVerification) {
        return {
          data: payload.data,
          error: payload.error ?? {
            message: 'Please verify your email to continue.',
            code: 'EMAIL_NOT_VERIFIED',
          },
        };
      }
      if (payload.data?.needs2FA) {
        return {
          data: payload.data,
          error: payload.error ?? {
            message: 'Enter the verification code sent to your email.',
            code: 'TWO_FACTOR_REQUIRED',
          },
        };
      }
      return payload;
    },

    async verifyTwoFactor({ challengeToken, code }: { challengeToken: string; code: string }) {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeToken, code }),
      });
      const payload = await res.json();
      if (res.ok && payload.data?.session) {
        triggerAuthChange('SIGNED_IN', payload.data.session);
      }
      return payload;
    },

    async resendTwoFactor({ challengeToken }: { challengeToken: string }) {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeToken }),
      });
      return await res.json();
    },

    async signUp({ email, password, options }: any) {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, options })
      });
      const payload = await res.json();
      if (res.ok && payload.data?.session) {
        triggerAuthChange('SIGNED_IN', payload.data.session);
      }
      if (payload.data?.needsVerification) {
        return {
          data: payload.data,
          error: null,
        };
      }
      return payload;
    },

    async signOut() {
      try {
        await fetch("/api/auth/signout", {
          method: "POST",
          credentials: "include",
        });
      } catch (err) {
        console.error("[auth] signOut request failed:", err);
      }
      triggerAuthChange("SIGNED_OUT", null);
      return { error: null };
    },

    async resetPasswordForEmail(email: string, options?: any) {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, options })
      });
      return await res.json();
    },

    async updateUser({ password, email }: any) {
      const res = await fetch('/api/auth/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, email })
      });
      return await res.json();
    },

    onAuthStateChange(callback: any) {
      authCallbacks.push(callback);
      // Trigger it once initially with current session status
      this.getSession().then(({ data }) => {
        if (data?.session) {
          callback('SIGNED_IN', data.session);
        } else {
          callback('SIGNED_OUT', null);
        }
      });

      return {
        data: {
          subscription: {
            unsubscribe: () => {
              const idx = authCallbacks.indexOf(callback);
              if (idx !== -1) {
                authCallbacks.splice(idx, 1);
              }
            }
          }
        }
      };
    }
  };

  const storage = {
    from(bucketName: string) {
      return {
        async upload(pathStr: string, file: File | Buffer, options?: any) {
          const formData = new FormData();
          formData.append('bucket', bucketName);
          formData.append('path', pathStr);
          formData.append('file', file as File);
          
          const res = await fetch('/api/storage/upload', {
            method: 'POST',
            body: formData
          });
          const payload = await res.json();
          if (!res.ok || payload.error) {
            const message =
              typeof payload.error === 'string'
                ? payload.error
                : payload.error?.message || 'Upload failed';
            return { data: null, error: { message } };
          }
          return payload;
        },

        getPublicUrl(pathStr: string) {
          const key = `${bucketName}/${pathStr}`;
          const publicUrl = `${process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-r2.wa.vedmint.com'}/${key}`;
          return { data: { publicUrl } };
        },

        async remove(paths: string[]) {
          await fetch('/api/storage/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket: bucketName, paths })
          });
          return { error: null };
        }
      };
    }
  };

  const channel = (channelName: string) => {
    const listeners: { table: string; callback: (payload: any) => void }[] = [];
    let eventSource: any = null;

    return {
      on(event: string, filter: any, callback: any) {
        listeners.push({
          table: filter.table,
          callback: (payload: any) => {
            const supabasePayload = {
              new: payload.record,
              // For UPDATE events the server publishes oldRecord separately;
              // fall back to {} so the shape is always an object (never null)
              // which matches what real Supabase Realtime sends.
              old: payload.type === 'UPDATE' ? (payload.oldRecord ?? {}) : {},
              eventType: payload.type,
              schema: 'public',
              table: payload.table,
              commit_timestamp: new Date().toISOString()
            };
            callback(supabasePayload);
          }
        });
        return this;
      },
      subscribe(statusCallback?: (status: string) => void) {
        if (typeof window !== 'undefined' && !eventSource) {
          eventSource = new EventSource('/api/realtime');
          eventSource.onopen = () => {
            statusCallback?.('SUBSCRIBED');
          };
          eventSource.onmessage = (e: any) => {
            try {
              const payload = JSON.parse(e.data);
              for (const listener of listeners) {
                if (listener.table === payload.table) {
                  listener.callback(payload);
                }
              }
            } catch (err) {
              console.error('[Emulator Realtime] error parsing message:', err);
            }
          };
          eventSource.onerror = () => {
            statusCallback?.('CLOSED');
          };
        }
        return this;
      },
      unsubscribe() {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      }
    };
  };

  const rpc = async (fnName: string, args?: any) => {
    const res = await fetch('/api/db-proxy/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fnName, args })
    });
    return await res.json();
  };

  return {
    from(tableName: string) {
      return new EmulatorQueryBuilder(tableName);
    },
    auth,
    storage,
    channel,
    removeChannel(chan: any) {
      if (chan && typeof chan.unsubscribe === 'function') {
        chan.unsubscribe();
      }
    },
    rpc
  };
}
