/**
 * The tiny server side of Spider Crawler, used by the CLI (`npx @lulu38m/spider-crawler`), the
 * Docker image and `npm run dev`. The web app works without it; it only adds:
 *
 *   GET /api/ping           what this server can do
 *   GET /api/fetch?url=…    fetches a public web page for the spider (browsers block most of
 *                           them with CORS). http and https only, 20 MB, 15 s, no private
 *                           network addresses unless allowPrivate is set.
 *   GET /api/file           the one local file passed on the command line, if any.
 *
 * Plain Node, no dependencies.
 */
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { basename } from 'node:path';
import zlib from 'node:zlib';

export const MAX_BYTES = 20 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SpiderCrawler/1.0; +https://github.com/lulu38m/spider-crawler)';

export class FetchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(net, prefix, 'ipv6');

/** True for addresses on the public internet. */
export function isPublicAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) return !(ip.toLowerCase().startsWith('::ffff:') || blocked.check(ip, 'ipv6'));
  return false;
}

/** Parses and vets a URL before any network access. */
export function checkUrl(input, { allowPrivate = false } = {}) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new FetchError(400, 'That does not look like a link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError(400, 'Only http and https links can be crawled.');
  if (url.username || url.password) throw new FetchError(400, 'Links with a password in them are not crawled.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate) {
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new FetchError(403, 'The spider only crawls the public web, not this computer or its network.');
    if (isIP(host) && !isPublicAddress(host)) throw new FetchError(403, 'The spider only crawls the public web, not this computer or its network.');
  }
  return url;
}

/** DNS lookup that refuses private answers, so a public name can't point the spider inside the network. */
function lookupFor(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const bad = allowPrivate ? undefined : addresses.find((a) => !isPublicAddress(a.address));
      if (bad) return callback(new FetchError(403, 'The spider only crawls the public web, not this computer or its network.'));
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function requestOnce(url, { allowPrivate, deadline }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      lookup: lookupFor(allowPrivate),
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/pdf,text/markdown,text/plain;q=0.9,*/*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en;q=0.9, *;q=0.5',
      },
    });
    const timer = setTimeout(() => req.destroy(new FetchError(504, 'The site took too long to answer.')), Math.max(1, deadline - Date.now()));
    const fail = (err) => {
      clearTimeout(timer);
      reject(err instanceof FetchError ? err : new FetchError(502, `Could not reach the site (${err.code ?? err.message}).`));
    };
    req.on('error', fail);
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        clearTimeout(timer);
        resolve({ redirect: res.headers.location });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        clearTimeout(timer);
        reject(new FetchError(502, `The site answered ${status}${res.statusMessage ? ` ${res.statusMessage}` : ''}.`));
        return;
      }
      if (Number(res.headers['content-length'] ?? 0) > MAX_BYTES) {
        req.destroy();
        fail(new FetchError(413, 'This page is over 20 MB, too big for the spider.'));
        return;
      }
      const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const decoder =
        encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
        : encoding === 'deflate' ? zlib.createInflate()
        : encoding === 'br' ? zlib.createBrotliDecompress()
        : null;
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          fail(new FetchError(413, 'This page is over 20 MB, too big for the spider.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', fail);
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ body: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? 'application/octet-stream') });
      });
    });
    req.end();
  });
}

/** Fetches a public URL, following up to five redirects and vetting every hop. */
export async function fetchRemote(input, { allowPrivate = false } = {}) {
  let url = checkUrl(input, { allowPrivate });
  const deadline = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, { allowPrivate, deadline });
    if (!res.redirect) return { ...res, finalUrl: url.href };
    url = checkUrl(new URL(res.redirect, url), { allowPrivate });
  }
  throw new FetchError(508, 'The site kept redirecting the spider.');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Middleware for Node's http server and for Vite (connect). Calls `next` for anything outside
 * /api/, or answers 404 when there is no `next`.
 */
export function createApiHandler({ allowPrivate = false, localFile = null } = {}) {
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (next) return next();
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    try {
      if (url.pathname === '/api/ping') {
        return sendJson(res, 200, { app: 'spider-crawler', fetch: true, file: localFile ? basename(localFile) : null });
      }
      if (url.pathname === '/api/fetch') {
        const target = url.searchParams.get('url');
        if (!target) return sendJson(res, 400, { error: 'Add ?url= with the page to crawl.' });
        const page = await fetchRemote(target, { allowPrivate });
        res.writeHead(200, {
          'content-type': page.contentType,
          'content-length': page.body.length,
          'x-final-url': encodeURI(page.finalUrl),
          'cache-control': 'no-store',
        });
        return res.end(req.method === 'HEAD' ? undefined : page.body);
      }
      if (url.pathname === '/api/file') {
        // Only for pages served from this computer: a DNS-rebinding page must not read the file.
        if (!localFile || !LOOPBACK_HOSTS.test(req.headers.host ?? '')) return sendJson(res, 404, { error: 'No file was opened.' });
        const body = await readFile(localFile);
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(basename(localFile)),
          'cache-control': 'no-store',
        });
        return res.end(body);
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof FetchError ? err.status : 500;
      return sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}
