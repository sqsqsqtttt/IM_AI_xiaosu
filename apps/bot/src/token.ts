/** 钉钉 access token 获取与缓存（提前 5 分钟刷新）。 */
let cached: { token: string; expiresAt: number } | null = null;

export async function getDingtalkAccessToken(
  appKey: string,
  appSecret: string,
): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 5 * 60_000) return cached.token;
  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`获取钉钉 accessToken 失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { accessToken: string; expireIn?: number };
  cached = {
    token: data.accessToken,
    expiresAt: Date.now() + (data.expireIn ?? 7200) * 1000,
  };
  return data.accessToken;
}
