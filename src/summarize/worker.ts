import { summarize } from './index';
import type { SummarizeOptions } from './types';

interface Request {
  id: number;
  text: string;
  options: SummarizeOptions;
}

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, text, options } = e.data;
  try {
    post({ id, summary: summarize(text, options) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
