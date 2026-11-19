import { computed, shallowRef } from 'vue';
import { getContext } from '@/st/context';

export interface VertexConnection {
  location: string;
  model: string;
  flex: boolean;
}

interface ServiceAccount {
  project: string;
  email: string;
  keyId?: string;
  privateKey: CryptoKey;
  tauriSecretId?: string;
}

const tokenUrl = 'https://oauth2.googleapis.com/token';
const tauriSecretKey = 'vertexai_service_account_json';
const tauriSecretLabel = '柏宝绘 · Vertex AI';
// 文字 GenerateContent 候选。新增或项目专用的模型可以直接输入。
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo
export const VERTEX_MODELS = [
  { id: 'gemini-4-neon', flex: false },
  { id: 'gemini-4-hydrogen', flex: false },
  { id: 'gemini-4-carbon', flex: false },
  { id: 'gemini-4-argon', flex: false },
  { id: 'gemini-3.8-flash', flex: true },
  { id: 'gemini-3.7-flash', flex: true },
  { id: 'gemini-3.5-flash', flex: true },
  { id: 'gemini-3.5-flash-lite', flex: true },
  { id: 'gemini-3.1-flash-lite', flex: true },
  { id: 'gemini-3.1-pro-preview', flex: true },
];
const storeName = 'credentials';
const recordId = 'vertex';
const account = shallowRef<ServiceAccount>();
const tokens = new WeakMap<ServiceAccount, { value: string; expiresAt: number }>();
let loading: Promise<void> | undefined;

export const hasVertexCredential = computed(() => Boolean(account.value));

function isTauriTavern(): boolean {
  return Boolean((globalThis as typeof globalThis & { __TAURITAVERN__?: unknown }).__TAURITAVERN__);
}

async function requestTauri(path: string, payload: object, signal?: AbortSignal) {
  const context = getContext();
  if (!context) throw new Error('TauriTavern 尚未就绪');
  const response = await fetch(path, {
    method: 'POST',
    headers: context.getRequestHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    const message = data?.error?.message ?? data?.message;
    const detail = !path.startsWith('/api/secrets/') && typeof message === 'string' ? ' ' + message.slice(0, 350) : '';
    throw new Error('TauriTavern 请求失败（HTTP ' + response.status + '）' + detail);
  }
  return data;
}

async function updateTauriSecrets(task: () => Promise<void>): Promise<void> {
  // 两个插件共用宿主的密钥列表，写入与恢复现有活动密钥需要串行。
  const locks = globalThis.navigator?.locks;
  if (locks) await locks.request('baibai-vertex-secrets', task);
  else await task();
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bbi-vertex-credentials', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机凭证存储'));
  });
}

async function credentialTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(new Error('无法读取或更新本机凭证'));
    });
  } finally {
    db.close();
  }
}

export function loadVertexCredential(): Promise<void> {
  return loading ??= credentialTransaction<ServiceAccount | undefined>('readonly', store => store.get(recordId))
    .then(stored => { account.value = stored; })
    .catch(error => {
      loading = undefined;
      throw error;
    });
}

export async function importVertexCredential(text: string): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error('凭证内容不是有效的 JSON');
  }

  if (data?.type !== 'service_account'
    || typeof data.project_id !== 'string' || !data.project_id.trim()
    || typeof data.client_email !== 'string' || !data.client_email.trim()
    || typeof data.private_key !== 'string' || !data.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('请使用 Google Cloud 导出的服务账号 JSON 密钥');
  }
  if (!globalThis.crypto?.subtle) throw new Error('当前页面不支持 Web Crypto，无法导入凭证');

  let privateKey: CryptoKey;
  try {
    const pem = data.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    const der = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
    privateKey = await crypto.subtle.importKey(
      'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
  } catch {
    throw new Error('无法读取服务账号 JSON 中的私钥');
  }
  const next: ServiceAccount = {
    project: data.project_id.trim(),
    email: data.client_email.trim(),
    keyId: typeof data.private_key_id === 'string' ? data.private_key_id : undefined,
    privateKey,
  };

  await loadVertexCredential();
  await updateTauriSecrets(async () => {
    const previousId = account.value?.tauriSecretId;
    if (isTauriTavern()) {
      const state = await requestTauri('/api/secrets/read', {});
      const active = state[tauriSecretKey]?.find((entry: { active: boolean }) => entry.active)?.id;
      const value = JSON.stringify({
        type: 'service_account',
        project_id: next.project,
        client_email: next.email,
        private_key: data.private_key,
        private_key_id: next.keyId,
        token_uri: tokenUrl,
      });
      const { id } = await requestTauri('/api/secrets/write', { key: tauriSecretKey, value, label: tauriSecretLabel });
      if (typeof id !== 'string' || !id) throw new Error('TauriTavern 未返回新凭证 ID');
      next.tauriSecretId = id;
      try {
        if (active && active !== previousId) await requestTauri('/api/secrets/rotate', { key: tauriSecretKey, id: active });
        await credentialTransaction('readwrite', store => store.put(next, recordId));
      } catch (error) {
        await requestTauri('/api/secrets/delete', { key: tauriSecretKey, id }).catch(() => {});
        if (active) await requestTauri('/api/secrets/rotate', { key: tauriSecretKey, id: active }).catch(() => {});
        throw error;
      }
      account.value = next;
      if (previousId) {
        await requestTauri('/api/secrets/delete', { key: tauriSecretKey, id: previousId }).catch(() => {});
      }
    } else {
      await credentialTransaction('readwrite', store => store.put(next, recordId));
      account.value = next;
    }
  });
}

export async function clearVertexCredential(): Promise<void> {
  await loadVertexCredential();
  await updateTauriSecrets(async () => {
    const id = account.value?.tauriSecretId;
    if (id && isTauriTavern()) await requestTauri('/api/secrets/delete', { key: tauriSecretKey, id });
    await credentialTransaction('readwrite', store => store.delete(recordId));
    account.value = undefined;
  });
}

export function normalizeVertexConnection(
  value: Partial<VertexConnection> | undefined,
  defaults: VertexConnection,
): VertexConnection {
  return {
    location: typeof value?.location === 'string' ? value.location : defaults.location,
    model: typeof value?.model === 'string' ? value.model : defaults.model,
    flex: value?.flex === true,
  };
}

export function vertexTimeoutSec(flex: boolean, requested?: number): number {
  const custom = typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested) : undefined;
  return flex ? Math.min(custom ?? 600, 1800) : custom ?? 180;
}

export function vertexFlexError(config: VertexConnection): string {
  if (!config.flex) return '';
  if ((config.location.trim() || 'global') !== 'global') return 'Flex PayGo 需要使用 global 地区';
  const model = VERTEX_MODELS.find(({ id }) => id === config.model.trim());
  return model?.flex === false ? '此模型请关闭 Flex 后使用' : '';
}

export function describeFlexTraffic(traffic?: string): string {
  if (traffic === 'ON_DEMAND_FLEX') return 'Flex 已确认';
  return traffic ? '实际处理层 ' + traffic : '已请求 Flex，TauriTavern 未返回实际处理层';
}

function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function accessToken(serviceAccount: ServiceAccount, signal: AbortSignal): Promise<string> {
  const cached = tokens.get(serviceAccount);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const encodeJson = (data: object) => base64Url(encoder.encode(JSON.stringify(data)));
  const header = encodeJson({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.keyId });
  const claims = encodeJson({
    iss: serviceAccount.email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  });
  const jwt = header + '.' + claims;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', serviceAccount.privateKey, encoder.encode(jwt));
  const response = await fetch(tokenUrl, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    signal,
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt + '.' + base64Url(new Uint8Array(signature)),
    }),
  });
  if (!response.ok) throw new Error('Google OAuth 换取令牌失败（HTTP ' + response.status + '）');

  const result = await response.json();
  if (typeof result?.access_token !== 'string' || !result.access_token) throw new Error('Google OAuth 未返回令牌');
  tokens.set(serviceAccount, { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 });
  return result.access_token;
}

export async function vertexRequest<T>(
  config: VertexConnection,
  body: object,
  signal: AbortSignal,
  timeoutSec: number,
): Promise<T> {
  const location = config.location.trim() || 'global';
  const model = config.model.trim();
  if (!/^[a-z][a-z0-9-]*$/.test(location)) throw new Error('Vertex AI 地区格式无效');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(model)) throw new Error('请填写有效的 Vertex AI 模型 ID');
  await loadVertexCredential();
  const flexError = vertexFlexError(config);
  if (flexError) throw new Error(flexError);
  const serviceAccount = account.value;
  if (!serviceAccount) throw new Error('请先导入 Vertex AI 服务账号 JSON 凭证');
  if (config.flex) {
    if (!isTauriTavern() || !serviceAccount.tauriSecretId) {
      throw new Error('请在 TauriTavern 内导入服务账号凭证，以使用 Flex PayGo');
    }
    // Google 的跨域预检拒绝 Flex 请求头，由 TauriTavern 的 Vertex AI 后端发送。
    const completion = await requestTauri('/api/backends/chat-completions/generate', {
      chat_completion_source: 'vertexai',
      vertexai_auth_mode: 'full',
      vertexai_region: 'global',
      secret_id: serviceAccount.tauriSecretId,
      model,
      stream: false,
      type: 'quiet',
      tool_choice: 'none',
      // 宿主需要 OpenAI 形状来初始化请求，随后用插件生成的 Gemini 原生 payload 覆盖。
      messages: [{ role: 'user', content: 'Vertex AI request' }],
      custom_include_body: JSON.stringify(body),
      custom_include_headers: JSON.stringify({
        'X-Vertex-AI-LLM-Request-Type': 'shared',
        'X-Vertex-AI-LLM-Shared-Request-Type': 'flex',
        'X-Server-Timeout': String(timeoutSec),
      }),
    }, signal);
    const message = completion.choices?.[0]?.message;
    const content = completion.responseContent ?? message?.native?.gemini?.content
      ?? { parts: [{ text: typeof message?.content === 'string' ? message.content : '' }] };
    return { candidates: [{ content }], usageMetadata: completion.usageMetadata } as T;
  }
  const project = encodeURIComponent(serviceAccount.project);
  const host = location === 'global' ? 'aiplatform.googleapis.com' : location + '-aiplatform.googleapis.com';
  const url = 'https://' + host + '/v1/projects/' + project + '/locations/' + location
    + '/publishers/google/models/' + encodeURIComponent(model) + ':generateContent';

  const token = await accessToken(serviceAccount, signal);
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result?.error?.message === 'string' ? result.error.message.slice(0, 350) : '';
    throw new Error('Vertex AI 请求失败（HTTP ' + response.status + '）' + (detail ? ' ' + detail : ''));
  }
  if (!result) throw new Error('Vertex AI 未返回有效的响应');
  return result;
}

export async function withVertexTimeout<T>(
  timeoutSec: number,
  outerSignal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) abort();
  outerSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Vertex AI 请求超时')), timeoutSec * 1000);
  try {
    controller.signal.throwIfAborted();
    return await request(controller.signal);
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
  }
}
