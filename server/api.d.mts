import type { IncomingMessage, ServerResponse } from 'node:http';

export declare const MAX_BYTES: number;
export declare const TIMEOUT_MS: number;
export declare class FetchError extends Error {
  status: number;
  constructor(status: number, message: string);
}
export declare function isPublicAddress(address: string): boolean;
export declare function checkUrl(input: string | URL, options?: { allowPrivate?: boolean }): URL;
export declare function fetchRemote(
  input: string | URL,
  options?: { allowPrivate?: boolean },
): Promise<{ body: Buffer; contentType: string; finalUrl: string }>;
export declare function createApiHandler(options?: {
  allowPrivate?: boolean;
  localFile?: string | null;
}): (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>;
