import type { DatabaseSync } from 'node:sqlite';

function now(): string {
  return new Date().toISOString();
}

export function createSettingsRepo(db: DatabaseSync) {
  return {
    get(key: string): string | null {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },
    set(key: string, value: string): void {
      db.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).run(key, value, now());
    },
    all(): Record<string, string> {
      const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
        key: string;
        value: string;
      }>;
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
