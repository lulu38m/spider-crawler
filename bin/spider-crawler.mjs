#!/usr/bin/env node
/**
 * Runs Spider Crawler on your computer: serves the built app, adds the link fetcher, opens the browser.
 *
 *   npx @lulu38m/spider-crawler                 open the app
 *   npx @lulu38m/spider-crawler notes.pdf       open it on a file
 *   npx @lulu38m/spider-crawler https://…       open it on a web page
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from '../server/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const HELP = `
Spider Crawler ${pkg.version}: a literal web crawler.

Usage
  spider-crawler [file or link] [options]

Examples
  spider-crawler                       open the app in your browser
  spider-crawler report.pdf            crawl a file
  spider-crawler https://example.com   crawl a web page

Options
  -p, --port <number>   port to listen on (default 4321, or the next free one)
      --host <name>     interface to listen on (default 127.0.0.1; 0.0.0.0 to share on your network)
      --no-open         don't open the browser
      --allow-private   let the link fetcher reach private network addresses (intranets)
  -v, --version         print the version
  -h, --help            print this help
`;

function fail(message) {
  console.error(`spider-crawler: ${message}`);
  process.exit(1);
}

// ── Arguments ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const options = {
  port: process.env.PORT ? Number(process.env.PORT) : null,
  host: process.env.HOST || '127.0.0.1',
  open: !process.env.SPIDER_NO_OPEN && !process.env.CI,
  allowPrivate: process.env.SPIDER_ALLOW_PRIVATE === '1',
  target: null,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => (args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : fail(`${a} needs a value`));
  if (a === '-h' || a === '--help') {
    console.log(HELP);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    console.log(pkg.version);
    process.exit(0);
  } else if (a === '-p' || a === '--port') options.port = Number(value());
  else if (a.startsWith('--port=')) options.port = Number(a.slice(7));
  else if (a === '--host') options.host = value();
  else if (a.startsWith('--host=')) options.host = a.slice(7);
  else if (a === '--no-open') options.open = false;
  else if (a === '--allow-private') options.allowPrivate = true;
  else if (a.startsWith('-')) fail(`unknown option ${a} (see --help)`);
  else if (options.target) fail('give one file or link at a time');
  else options.target = a;
}
if (options.port !== null && !(Number.isInteger(options.port) && options.port >= 0 && options.port < 65536)) fail('the port must be a number between 0 and 65535');

let localFile = null;
let query = '';
if (options.target) {
  if (/^https?:\/\//i.test(options.target)) query = `?url=${encodeURIComponent(options.target)}`;
  else {
    const file = resolve(options.target);
    if (!existsSync(file) || !statSync(file).isFile()) fail(`no such file: ${options.target}`);
    localFile = file;
    query = '?local=1';
  }
}

if (!existsSync(join(dist, 'index.html'))) {
  fail(`the app isn't built yet. Run \`npm run build\` in ${root} first.`);
}

// ── Static files ──────────────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
};

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(dist, `.${path}`);
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const api = createApiHandler({ allowPrivate: options.allowPrivate, localFile });
const server = createServer((req, res) => {
  api(req, res, () => void serveStatic(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end();
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
function listen(port) {
  return new Promise((ok, ko) => {
    const onError = (err) => {
      server.off('listening', onListening);
      ko(err);
    };
    const onListening = () => {
      server.off('error', onError);
      ok(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, options.host);
  });
}

let port;
if (options.port !== null) {
  try {
    port = await listen(options.port);
  } catch (err) {
    fail(err.code === 'EADDRINUSE' ? `port ${options.port} is already in use. Try another one with --port.` : err.message);
  }
} else {
  for (let p = 4321; p < 4341 && port === undefined; p++) {
    try {
      port = await listen(p);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') fail(err.message);
    }
  }
  port ??= await listen(0);
}

const shownHost = ['0.0.0.0', '::', '127.0.0.1', '::1'].includes(options.host) ? 'localhost' : options.host;
const url = `http://${shownHost}:${port}/${query}`;
console.log(`\n  Spider Crawler is running at \x1b[1m${url}\x1b[0m`);
if (options.host === '0.0.0.0' || options.host === '::') console.log('  Listening on every network interface.');
console.log('  Press Ctrl+C to stop.\n');

if (options.open) {
  const [cmd, cmdArgs] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* no browser: the address is printed above */
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
