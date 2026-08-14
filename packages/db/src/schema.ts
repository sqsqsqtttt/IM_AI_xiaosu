/** 全部建表语句（幂等，启动时执行）。 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | indexed | failed
  error       TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id        TEXT PRIMARY KEY,
  doc_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  heading   TEXT,
  content   TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL,          -- dingtalk | web
  user_id         TEXT NOT NULL,          -- 钉钉 userId / web 端匿名标识
  conversation_id TEXT NOT NULL,          -- 钉钉会话ID（群ID/单聊ID）/ web 端 uuid
  title           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(platform, user_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,          -- user | assistant | tool
  content         TEXT NOT NULL,
  tool_calls      TEXT,                   -- JSON: [{name, args, result}]
  citations       TEXT,                   -- JSON: Citation[]
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  cost            REAL,
  latency_ms      INTEGER,
  status          TEXT,                   -- ok | error
  error           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_heartbeat (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  status    TEXT NOT NULL,               -- connected | disconnected | disabled
  last_seen TEXT NOT NULL
);
`;
