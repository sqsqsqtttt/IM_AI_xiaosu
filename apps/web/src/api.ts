export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `请求失败: ${res.status}`);
  return data;
}

export async function uploadDocument(file: File): Promise<{ doc: unknown; skipped: boolean }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/documents', { method: 'POST', body: fd });
  const data = (await res.json()) as { doc: unknown; skipped: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? `上传失败: ${res.status}`);
  return data;
}

export interface ChatStreamEvents {
  onDelta?: (text: string) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

/** 聊天 SSE：POST + 流式读取。 */
export async function chatStream(
  message: string,
  conversationId: string,
  events: ChatStreamEvents,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok || !res.body) {
    events.onError?.(`请求失败: ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim()) as { type: string } & Record<string, unknown>;
        if (evt.type === 'delta') events.onDelta?.(String(evt.content ?? ''));
        else if (evt.type === 'done') events.onDone?.(evt);
        else if (evt.type === 'error') events.onError?.(String(evt.message ?? '服务器错误'));
      } catch {
        // 忽略坏行
      }
    }
  }
}
