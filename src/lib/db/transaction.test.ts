import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pooledTransaction, transaction } from './transaction';

describe('database transaction', () => {
  it('commits successful writes and rolls back failed writes', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      await db.exec('CREATE TABLE items (id int PRIMARY KEY)');
      await transaction(db, async (sql) => {
        await sql.query('INSERT INTO items VALUES ($1)', [1]);
      });
      await expect(
        transaction(db, async (sql) => {
          await sql.query('INSERT INTO items VALUES ($1)', [2]);
          throw new Error('operation failed');
        })
      ).rejects.toThrow('operation failed');
      expect((await db.query('SELECT id FROM items ORDER BY id')).rows).toEqual(
        [{ id: 1 }]
      );
    } finally {
      await db.close();
    }
  });
  it('releases a leased connection after errors so another request can use it', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    let leased = false;
    let released = 0;
    const pool = {
      connect: async () => {
        if (leased) throw new Error('Connection not released');
        leased = true;
        return {
          query: db.query.bind(db),
          release: () => {
            leased = false;
            released++;
          },
        };
      },
    };
    try {
      await db.exec('CREATE TABLE items(id int PRIMARY KEY)');
      await expect(
        pooledTransaction(pool, async (sql) => {
          await sql.query('INSERT INTO items VALUES (1)');
          throw new Error('request failed');
        })
      ).rejects.toThrow('request failed');
      await pooledTransaction(pool, async (sql) => {
        await sql.query('INSERT INTO items VALUES (2)');
      });
      expect((await db.query('SELECT id FROM items')).rows).toEqual([
        { id: 2 },
      ]);
      expect(released).toBe(2);
    } finally {
      await db.close();
    }
  });
});
