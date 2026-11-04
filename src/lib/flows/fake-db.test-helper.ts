type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeTables = Record<string, Row[]>;

function readColumn(row: Row, column: string): unknown {
  const [base, jsonKey] = column.split("->>");
  if (jsonKey === undefined) return row[base];
  const json = row[base] as Row | null | undefined;
  return json?.[jsonKey] ?? null;
}

export function createFakeDb(tables: FakeTables, failingTables: ReadonlySet<string> = new Set()) {
  let idCounter = 0;

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" | "delete" = "select";
    let patch: Row = {};
    let inserted: Row[] = [];
    let limit: number | null = null;
    let headCount = false;

    const execute = () => {
      if (failingTables.has(table)) {
        return { data: null, error: { message: `${table} unavailable` }, count: null };
      }
      const rows = tables[table];
      if (op === "insert") {
        return { data: inserted.map((r) => structuredClone(r)), error: null, count: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, structuredClone(patch));
        return { data: matched.map((r) => structuredClone(r)), error: null, count: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null, count: null };
      }
      const limited = limit === null ? matched : matched.slice(0, limit);
      return {
        data: headCount ? null : limited.map((r) => structuredClone(r)),
        error: null,
        count: matched.length,
      };
    };

    const builder: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) headCount = true;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((r) => readColumn(r, column) === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((r) => (readColumn(r, column) ?? null) === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((r) => values.includes(readColumn(r, column)));
        return builder;
      },
      filter: (column: string, operator: string, value: unknown) => {
        if (operator === "eq") filters.push((r) => readColumn(r, column) === value);
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      update: (values: Row) => {
        op = "update";
        patch = values;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      insert: (values: Row | Row[]) => {
        op = "insert";
        const list = Array.isArray(values) ? values : [values];
        inserted = list.map((v) => {
          idCounter += 1;
          return { id: `gen-${idCounter}`, vars: {}, reprompt_count: 0, transition_seq: 0, ...v };
        });
        tables[table].push(...inserted);
        return builder;
      },
      maybeSingle: async () => {
        const result = execute();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : null;
        return { data, error: result.error };
      },
      then: (resolve: (r: ReturnType<typeof execute>) => unknown) =>
        Promise.resolve().then(() => resolve(execute())),
    };
    return builder;
  }

  return {
    from,
    rpc: async () => ({ error: null }),
  };
}
