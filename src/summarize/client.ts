import { summarize } from './index';
import type { Summary, SummarizeOptions } from './types';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (s: Summary) => void; reject: (e: Error) => void }>();

/** Summarize off the main thread so the spider keeps moving while the text is analyzed. */
export function summarizeAsync(text: string, options: SummarizeOptions = {}): Promise<Summary> {
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; summary?: Summary; error?: string }>) => {
        const job = waiting.get(e.data.id);
        if (!job) return;
        waiting.delete(e.data.id);
        if (e.data.summary) job.resolve(e.data.summary);
        else job.reject(new Error(e.data.error ?? 'Summary failed'));
      };
      worker.onerror = () => {
        // Fall back to the main thread for everything still waiting.
        worker = null;
      };
    }
  } catch {
    worker = null;
  }
  if (!worker) return Promise.resolve(summarize(text, options));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, text, options });
  }).catch(() => summarize(text, options)) as Promise<Summary>;
}
