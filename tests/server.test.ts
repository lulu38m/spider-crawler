import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkUrl, createApiHandler, isPublicAddress } from '../server/api.mjs';

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it('allows the public internet', () => {
    for (const ip of ['1.1.1.1', '93.184.215.14', '2606:4700:4700::1111', '::ffff:1.1.1.1']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('checkUrl', () => {
  it('only lets public http(s) links through', () => {
    expect(checkUrl('https://example.com/x').hostname).toBe('example.com');
    expect(() => checkUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => checkUrl('http://localhost:3000')).toThrow(/public web/);
    expect(() => checkUrl('http://127.0.0.1/')).toThrow(/public web/);
    expect(() => checkUrl('http://[::1]/')).toThrow(/public web/);
    expect(() => checkUrl('http://169.254.169.254/latest/meta-data')).toThrow(/public web/);
    expect(() => checkUrl('http://user:pw@example.com/')).toThrow(/password/);
    expect(() => checkUrl('not a url')).toThrow(/link/);
    expect(checkUrl('http://127.0.0.1/', { allowPrivate: true }).hostname).toBe('127.0.0.1');
  });
});

describe('API handler', () => {
  let upstream: Server;
  let api: Server;
  let apiOpen: Server;
  let up = '';
  const base = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const listen = (s: Server) => new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
        res.end(gzipSync('<title>Hi</title><p>Silk is strong.</p>'));
      } else if (req.url === '/hop') {
        res.writeHead(302, { location: '/page' });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    api = createServer(createApiHandler());
    apiOpen = createServer(createApiHandler({ allowPrivate: true, localFile: new URL(import.meta.url).pathname }));
    await Promise.all([listen(upstream), listen(api), listen(apiOpen)]);
    up = base(upstream);
  });
  afterAll(() => {
    upstream.close();
    api.close();
    apiOpen.close();
  });

  it('answers ping', async () => {
    const res = await fetch(`${base(api)}/api/ping`);
    expect(await res.json()).toEqual({ app: 'spider-crawler', fetch: true, file: null });
  });

  it('refuses to fetch this computer by default', async () => {
    const res = await fetch(`${base(api)}/api/fetch?url=${encodeURIComponent(`${up}/page`)}`);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/public web/);
  });

  it('fetches, follows redirects and decompresses', async () => {
    const res = await fetch(`${base(apiOpen)}/api/fetch?url=${encodeURIComponent(`${up}/hop`)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(decodeURI(res.headers.get('x-final-url')!)).toBe(`${up}/page`);
    expect(await res.text()).toContain('Silk is strong.');
  });

  it('passes upstream errors on', async () => {
    const res = await fetch(`${base(apiOpen)}/api/fetch?url=${encodeURIComponent(`${up}/missing`)}`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/404/);
  });

  it('serves the command-line file to local pages only', async () => {
    const res = await fetch(`${base(apiOpen)}/api/file`);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('x-file-name')!)).toBe('server.test.ts');
    const rebound = await new Promise<number>((ok) => {
      // A page on another host name pointing at this server (DNS rebinding) gets nothing.
      import('node:http').then(({ get }) => get(`${base(apiOpen)}/api/file`, { headers: { host: 'evil.example:80' } }, (r) => ok(r.statusCode ?? 0)));
    });
    expect(rebound).toBe(404);
  });
});
