import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ChunkRow, DocStatus, DocumentRow } from '../types.ts';

function now(): string {
  return new Date().toISOString();
}

export interface NewDocument {
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface NewChunk {
  seq: number;
  heading: string | null;
  content: string;
  embedding: Uint8Array | null;
}

function rowToDocument(r: Record<string, unknown>): DocumentRow {
  return r as unknown as DocumentRow;
}

export function createDocumentsRepo(db: DatabaseSync) {
  return {
    /** 按 (name, sha256) 查同文件。 */
    findByHash(name: string, sha256: string): DocumentRow | null {
      const row = db
        .prepare('SELECT * FROM documents WHERE name = ? AND sha256 = ?')
        .get(name, sha256);
      return row ? rowToDocument(row) : null;
    },

    /** 查同名文件（内容可能不同，用于增量替换）。 */
    findByName(name: string): DocumentRow | null {
      const row = db.prepare('SELECT * FROM documents WHERE name = ?').get(name);
      return row ? rowToDocument(row) : null;
    },

    get(id: string): DocumentRow | null {
      const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      return row ? rowToDocument(row) : null;
    },

    list(): DocumentRow[] {
      const rows = db
        .prepare('SELECT * FROM documents ORDER BY updated_at DESC')
        .all();
      return rows.map(rowToDocument);
    },

    insert(doc: NewDocument): DocumentRow {
      const id = randomUUID();
      const t = now();
      db.prepare(
        `INSERT INTO documents (id, name, mime, size, sha256, status, chunk_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      ).run(id, doc.name, doc.mime, doc.size, doc.sha256, t, t);
      return this.get(id)!;
    },

    updateStatus(id: string, status: DocStatus, error: string | null): void {
      db.prepare('UPDATE documents SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
        status,
        error,
        now(),
        id,
      );
    },

    /** 增量替换时更新文件元信息（大小/哈希/格式）。 */
    updateMeta(id: string, meta: { mime: string; size: number; sha256: string }): void {
      db.prepare('UPDATE documents SET mime = ?, size = ?, sha256 = ?, updated_at = ? WHERE id = ?').run(
        meta.mime,
        meta.size,
        meta.sha256,
        now(),
        id,
      );
    },

    setChunkCount(id: string, chunkCount: number): void {
      db.prepare('UPDATE documents SET chunk_count = ?, updated_at = ? WHERE id = ?').run(
        chunkCount,
        now(),
        id,
      );
    },

    /** 替换文档的全部分块（增量更新用）。 */
    replaceChunks(docId: string, chunks: NewChunk[]): void {
      const del = db.prepare('DELETE FROM chunks WHERE doc_id = ?');
      const ins = db.prepare(
        'INSERT INTO chunks (id, doc_id, seq, heading, content, embedding) VALUES (?, ?, ?, ?, ?, ?)',
      );
      db.exec('BEGIN');
      try {
        del.run(docId);
        for (const c of chunks) {
          ins.run(randomUUID(), docId, c.seq, c.heading, c.content, c.embedding);
        }
        this.setChunkCount(docId, chunks.length);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    listChunks(docId: string): ChunkRow[] {
      const rows = db
        .prepare('SELECT id, doc_id, seq, heading, content, embedding FROM chunks WHERE doc_id = ? ORDER BY seq')
        .all(docId);
      return rows as unknown as ChunkRow[];
    },

    listAllChunks(): Array<ChunkRow & { doc_name: string }> {
      const rows = db
        .prepare(
          `SELECT c.id, c.doc_id, c.seq, c.heading, c.content, c.embedding, d.name AS doc_name
           FROM chunks c JOIN documents d ON d.id = c.doc_id
           WHERE d.status = 'indexed' ORDER BY c.doc_id, c.seq`,
        )
        .all();
      return rows as unknown as Array<ChunkRow & { doc_name: string }>;
    },

    /** 删除文档（分块级联删除，问答立即失效）。 */
    remove(id: string): void {
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    },
  };
}

export type DocumentsRepo = ReturnType<typeof createDocumentsRepo>;
