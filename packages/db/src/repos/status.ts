import type { DatabaseSync } from 'node:sqlite';

function now(): string {
  return new Date().toISOString();
}

export type BotStatus = 'connected' | 'disconnected' | 'disabled';

/** 机器人心跳：IM 状态展示（管理后台「设置」页）。 */
export function createStatusRepo(db: DatabaseSync) {
  return {
    setBotStatus(status: BotStatus): void {
      db.prepare(
        `INSERT INTO bot_heartbeat (id, status, last_seen) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, last_seen = excluded.last_seen`,
      ).run(status, now());
    },
    getBotStatus(): { status: BotStatus; last_seen: string } | null {
      const row = db.prepare('SELECT status, last_seen FROM bot_heartbeat WHERE id = 1').get() as
        | { status: BotStatus; last_seen: string }
        | undefined;
      return row ?? null;
    },
  };
}

export type StatusRepo = ReturnType<typeof createStatusRepo>;
