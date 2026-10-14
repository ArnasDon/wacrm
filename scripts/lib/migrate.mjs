import { createHash } from 'node:crypto';

/** Run on one dedicated connection: PostgreSQL advisory locks are session-scoped. */
export async function migrate(
  db,
  files,
  { advisoryLock = true, preflight = false } = {}
) {
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(ordered.map((f) => f.name)).size !== ordered.length)
    throw new Error('Duplicate migration names');
  if (advisoryLock) await db.query('SELECT pg_advisory_lock(148865412)');
  try {
    if (preflight) {
      const tracked = await db.query(
        "SELECT to_regclass('public.app_migrations') AS relation"
      );
      if (!tracked.rows[0].relation) {
        const existing =
          await db.query(`SELECT c.relname AS table_name FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
          ORDER BY c.relname`);
        if (existing.rows.length)
          throw new Error(
            `Existing unmanaged schema (${existing.rows.map((r) => r.table_name).join(', ')}). No tables were changed. Review/adopt its schema before migration.`
          );
      }
    }
    await db.query(
      'CREATE TABLE IF NOT EXISTS public.app_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const { rows } = await db.query(
      'SELECT name, checksum FROM public.app_migrations'
    );
    const history = new Map(rows.map((r) => [r.name, r.checksum]));
    for (const name of history.keys())
      if (!ordered.some((f) => f.name === name))
        throw new Error(`Applied migration missing from disk: ${name}`);
    const applied = [];
    for (const file of ordered) {
      const checksum = createHash('sha256').update(file.sql).digest('hex');
      if (history.has(file.name)) {
        if (history.get(file.name) !== checksum)
          throw new Error(`Migration checksum mismatch: ${file.name}`);
        continue;
      }
      await db.query('BEGIN');
      try {
        // exec supports multiple statements in embedded integration PostgreSQL;
        // node-postgres query supports the same operation without parameters.
        if (typeof db.exec === 'function') await db.exec(file.sql);
        else await db.query(file.sql);
        await db.query(
          'INSERT INTO public.app_migrations(name, checksum) VALUES ($1, $2)',
          [file.name, checksum]
        );
        await db.query('COMMIT');
        applied.push(file.name);
      } catch (error) {
        await db.query('ROLLBACK');
        // Do not retain driver query text/parameters: errors may otherwise dump
        // an entire schema or sensitive SQL values into logs and test reports.
        throw new Error(`Migration ${file.name} failed: ${error.message}`);
      }
    }
    return applied;
  } finally {
    if (advisoryLock) await db.query('SELECT pg_advisory_unlock(148865412)');
  }
}
