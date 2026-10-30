import { CODE_EXTENSIONS } from '../summarize/code';
import { extensionOf, UnsupportedFileError, type LoadInput } from './load';

export const MAX_LINK_BYTES = 20 * 1024 * 1024;

/** The command that runs the spider on your own computer, where any link can be crawled. */
export const LOCAL_COMMAND = 'npx @lulu38m/spider-crawler';

/**
 * Reads a link out of what the user typed or pasted: "https://…", "http://…", or a bare
 * "example.com/page". Returns null for anything else, including text that merely contains a link.
 */
export function parseLink(input: string): URL | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  let candidate = text;
  if (!/^https?:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]+:\d+(\/|$)/.test(text)) return null; // mailto:, file:, javascript:…
    if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(text)) return null;
    candidate = `https://${text}`;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export interface LinkPlan {
  /** Addresses to try in order (the first that answers wins). */
  urls: URL[];
  /** A nicer name than the page would give, when the address already says it. */
  name?: string;
  ext?: string;
  /** Turns what the address returns into a document (e.g. Wikipedia's JSON into HTML). */
  transform?: (body: ArrayBuffer) => string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Wikipedia's parse API answers JSON with the rendered article. */
export function wikipediaToHtml(body: ArrayBuffer): string {
  const json = JSON.parse(new TextDecoder().decode(body)) as { parse?: { title?: string; text?: string }; error?: { info?: string } };
  if (!json.parse?.text) throw new UnsupportedFileError(json.error?.info ? `Wikipedia: ${json.error.info}` : 'Wikipedia did not return this article.');
  const title = escapeHtml(json.parse.title ?? 'Wikipedia');
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${json.parse.text}</article></body></html>`;
}

/**
 * Some sites have a cleaner, CORS-friendly version of the same content: GitHub files and READMEs
 * (raw.githubusercontent.com) and Wikipedia articles (its public API). Everything else is fetched as is.
 */
export function planLink(url: URL): LinkPlan {
  const host = url.hostname.replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo] = parts;
    const name = repo.replace(/\.git$/, '');
    if ((parts[2] === 'blob' || parts[2] === 'raw') && parts.length >= 5) {
      const path = parts.slice(3).map(encodeURIComponent).join('/');
      return { urls: [new URL(`https://raw.githubusercontent.com/${owner}/${name}/${path}`)], name: parts[parts.length - 1] };
    }
    if (parts.length === 2 || parts[2] === 'tree') {
      const ref = parts[2] === 'tree' && parts[3] ? encodeURIComponent(parts[3]) : 'HEAD';
      const readme = (file: string) => new URL(`https://raw.githubusercontent.com/${owner}/${name}/${ref}/${file}`);
      return { urls: [readme('README.md'), readme('readme.md'), readme('README.markdown'), readme('README')], name: `${owner}/${name}`, ext: 'md' };
    }
  }

  const wiki = url.hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/i);
  if (wiki && parts[0] === 'wiki' && parts[1] && !parts[1].includes(':')) {
    const title = parts.slice(1).join('/');
    const api = new URL(`https://${wiki[1]}.wikipedia.org/w/api.php`);
    api.search = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1', disableeditsection: '1', origin: '*' }).toString();
    return { urls: [api], name: title.replace(/_/g, ' '), ext: 'html', transform: wikipediaToHtml };
  }

  return { urls: [url] };
}

/** Picks a parser from the Content-Type, falling back on the address' extension. */
export function extForResponse(contentType: string, url: URL): string {
  const type = contentType.toLowerCase().split(';')[0].trim();
  const fromPath = extensionOf(url.pathname);
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'md';
  if (type.includes('wordprocessingml')) return 'docx';
  if (fromPath && (fromPath === 'pdf' || fromPath === 'docx' || fromPath === 'md' || fromPath === 'markdown' || fromPath === 'txt' || CODE_EXTENSIONS.has(fromPath))) return fromPath;
  if (type.startsWith('text/')) return 'txt';
  return fromPath;
}

/** "Spider silk &amp; you" from <title>, or null. */
export function htmlTitle(html: string): string | null {
  const m = html.slice(0, 200_000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e] ?? '');
}

/** Name shown for a document opened from a link: its title, its file name, or its site. */
export function nameForLink(url: URL, ext: string, body: ArrayBuffer, hint?: string): string {
  if (hint) return hint;
  if (ext === 'html') {
    const title = htmlTitle(new TextDecoder().decode(body.slice(0, 200_000)));
    if (title) return title.length > 90 ? `${title.slice(0, 89)}…` : title;
  }
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (last && extensionOf(last)) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  return url.hostname.replace(/^www\./, '');
}

let proxy: Promise<boolean> | null = null;

/** True when the page is served by the Spider Crawler CLI, Docker image or dev server. */
export function hasLinkProxy(): Promise<boolean> {
  proxy ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/ping`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false;
      return (await res.json())?.app === 'spider-crawler';
    } catch {
      return false;
    }
  })();
  return proxy;
}

async function readBody(res: Response): Promise<ArrayBuffer> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_LINK_BYTES) throw new UnsupportedFileError('This page is over 20 MB, too big for the spider.');
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_LINK_BYTES) throw new UnsupportedFileError('This page is over 20 MB, too big for the spider.');
  return body;
}

async function viaProxy(url: URL): Promise<{ res: Response; finalUrl: URL }> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/fetch?url=${encodeURIComponent(url.href)}`, { cache: 'no-store' });
  if (!res.ok) {
    let message = `The spider couldn't fetch this link (${res.status}).`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    throw Object.assign(new UnsupportedFileError(message), { status: res.status });
  }
  const final = res.headers.get('x-final-url');
  return { res, finalUrl: final ? new URL(decodeURI(final)) : url };
}

async function direct(url: URL): Promise<{ res: Response; finalUrl: URL }> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
  } catch {
    throw new UnsupportedFileError(
      `${url.hostname} doesn't let other web pages read it, so this page can't fetch it. Run the spider on your computer with ${LOCAL_COMMAND} to crawl any link, or save the page and drop the file here.`,
    );
  }
  if (!res.ok) throw Object.assign(new UnsupportedFileError(`${url.hostname} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`), { status: res.status });
  return { res, finalUrl: new URL(res.url || url.href) };
}

/** Downloads a link and gets it ready for loadDocument(). */
export async function fetchLink(url: URL): Promise<LoadInput> {
  const plan = planLink(url);
  const get = (await hasLinkProxy()) ? viaProxy : direct;
  let lastError: unknown = null;
  for (const candidate of plan.urls) {
    try {
      const { res, finalUrl } = await get(candidate);
      const body = await readBody(res);
      const ext = plan.ext ?? extForResponse(res.headers.get('content-type') ?? '', finalUrl);
      const name = nameForLink(finalUrl, ext, body, plan.name);
      return { name, data: plan.transform ? plan.transform(body) : body, ext: ext || undefined, source: url.href };
    } catch (err) {
      lastError = err;
      // Only a missing README variant is worth another try.
      const status = (err as { status?: number }).status;
      if (plan.urls.length === 1 || !(status === 404 || status === 502)) break;
    }
  }
  throw lastError;
}
