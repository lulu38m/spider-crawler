import type { AiSummary } from './types';

/**
 * Optional abstractive summary. Bring your own key: requests go straight from the browser to the
 * provider you pick, nothing passes through a server of ours (there isn't one).
 */

export type ProviderId = 'off' | 'anthropic' | 'openai';

export interface AiSettings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, OpenRouter, Groq...). */
  baseUrl: string;
}

export const DEFAULT_AI: AiSettings = { provider: 'off', apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' };
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';
const STORAGE_KEY = 'spider-crawler.ai';
const MAX_CHARS = 120_000;

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_AI, ...JSON.parse(raw) } : { ...DEFAULT_AI };
  } catch {
    return { ...DEFAULT_AI };
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage can be unavailable (private mode); settings then last for this visit only */
  }
}

export function aiLabel(s: AiSettings): string {
  if (s.provider === 'anthropic') return `Claude (${s.model || DEFAULT_CLAUDE_MODEL})`;
  if (s.provider === 'openai') return s.model || 'OpenAI-compatible';
  return 'Off';
}

const SYSTEM = `You summarize documents for a reader in a hurry.
Reply with JSON only, nothing before or after it: {"tldr": string, "points": string[]}.
- tldr: one or two sentences, at most 45 words, stating what the document is about and its main point.
- points: 3 to 6 short bullet points with the key ideas, facts or decisions.
Write in the same language as the document. Do not invent facts.`;

const FINANCE = `
This is a financial report or analysis. Lead with the results: in the tldr and the points, give the headline figures (revenue, profit, margins, cash, guidance) with their exact values, changes and periods as stated in the document. Do not add opinions or investment advice.`;

export async function aiSummarize(name: string, text: string, s: AiSettings, signal?: AbortSignal, financial = false): Promise<AiSummary> {
  const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…truncated]` : text;
  const system = financial ? SYSTEM + FINANCE : SYSTEM;
  const prompt = `Document title: ${name}\n\n<document>\n${body}\n</document>`;
  let reply = '';
  if (s.provider === 'anthropic') {
    const model = s.model || DEFAULT_CLAUDE_MODEL;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calls made directly from a browser (bring-your-own-key apps).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(await errorText(res, 'Claude'));
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    reply = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return parse(reply, 'Claude', model);
  }
  if (s.provider === 'openai') {
    const base = (s.baseUrl || DEFAULT_AI.baseUrl).replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: s.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(await errorText(res, base));
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    reply = data.choices?.[0]?.message?.content ?? '';
    return parse(reply, new URL(base).host, s.model);
  }
  throw new Error('No AI provider is configured.');
}

async function errorText(res: Response, who: string): Promise<string> {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message ?? j?.message ?? '';
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) return `${who} rejected the API key (${res.status}). Check it in AI settings.`;
  return `${who} answered ${res.status}${detail ? `: ${detail}` : ''}.`;
}

function parse(reply: string, provider: string, model: string): AiSummary {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const obj = JSON.parse(json) as { tldr?: unknown; points?: unknown };
      const tldr = typeof obj.tldr === 'string' ? obj.tldr.trim() : '';
      const points = Array.isArray(obj.points) ? obj.points.filter((p): p is string => typeof p === 'string').map((p) => p.trim()) : [];
      if (tldr) return { provider, model, tldr, points };
    } catch {
      /* fall through */
    }
  }
  const text = reply.trim();
  if (!text) throw new Error('The model returned an empty answer.');
  return { provider, model, tldr: text.split('\n')[0].slice(0, 400), points: [] };
}
