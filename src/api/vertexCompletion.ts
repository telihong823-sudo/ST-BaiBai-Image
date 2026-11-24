import type { ChatMsg } from './client';
import { vertexRequest, vertexTimeoutSec, withVertexTimeout, type VertexConnection } from './vertex';

export interface VertexTextSettings extends Omit<VertexConnection, 'id'> {
  maxTokens: number;
  timeoutSec: number;
}

export const DEFAULT_VERTEX_TEXT: VertexTextSettings = {
  location: 'global',
  model: 'gemini-3.5-flash',
  flex: false,
  priority: false,
  maxTokens: 65535,
  timeoutSec: 0,
};

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { trafficType?: string; promptTokenCount?: number; candidatesTokenCount?: number };
}

export async function requestVertexCompletion(
  config: VertexTextSettings & Pick<VertexConnection, 'id'>,
  messages: ChatMsg[],
  { signal, connectivityTest = false }: { signal?: AbortSignal; connectivityTest?: boolean } = {},
) {
  const maxTokens = Math.max(1, Math.floor(config.maxTokens || DEFAULT_VERTEX_TEXT.maxTokens));
  const timeout = vertexTimeoutSec(config.flex, config.timeoutSec);
  const result = await withVertexTimeout(timeout, signal,
    activeSignal => vertexRequest<GeminiResponse>(config, messages, {
      maxTokens, signal: activeSignal, timeoutSec: timeout, connectivityTest,
    }));
  const candidate = result.candidates?.[0];
  const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('').trim();
  if (!text) {
    const reason = result.promptFeedback?.blockReason ?? candidate?.finishReason;
    throw new Error(reason ? 'Vertex AI 未返回正文（' + reason + '）' : 'Vertex AI 返回空正文');
  }
  return {
    content: text,
    trafficType: result.usageMetadata?.trafficType,
    usage: {
      prompt: result.usageMetadata?.promptTokenCount ?? null,
      completion: result.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}
