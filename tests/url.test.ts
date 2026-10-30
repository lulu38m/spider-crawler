import { describe, expect, it } from 'vitest';
import { extForResponse, htmlTitle, nameForLink, parseLink, planLink, wikipediaToHtml } from '../src/doc/url';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('parseLink', () => {
  it('accepts full and bare web addresses', () => {
    expect(parseLink('https://example.com/a?b=1')?.href).toBe('https://example.com/a?b=1');
    expect(parseLink('  http://example.com  ')?.href).toBe('http://example.com/');
    expect(parseLink('example.com/post')?.href).toBe('https://example.com/post');
    expect(parseLink('www.example.co.uk')?.href).toBe('https://www.example.co.uk/');
  });

  it('rejects text, other schemes and sentences that contain a link', () => {
    expect(parseLink('hello')).toBeNull();
    expect(parseLink('notes.md')).not.toBeNull(); // .md is a real TLD; acceptable, the fetch will tell
    expect(parseLink('read https://example.com now')).toBeNull();
    expect(parseLink('javascript:alert(1)')).toBeNull();
    expect(parseLink('file:///etc/passwd')).toBeNull();
    expect(parseLink('mailto:a@b.c')).toBeNull();
    expect(parseLink('ftp://example.com/file.txt')).toBeNull();
  });
});

describe('planLink', () => {
  it('reads GitHub repositories through their README', () => {
    const plan = planLink(new URL('https://github.com/mozilla/readability'));
    expect(plan.urls[0].href).toBe('https://raw.githubusercontent.com/mozilla/readability/HEAD/README.md');
    expect(plan.urls.length).toBeGreaterThan(1);
    expect(plan.name).toBe('mozilla/readability');
    expect(plan.ext).toBe('md');
  });

  it('reads GitHub files raw', () => {
    const plan = planLink(new URL('https://github.com/a/b/blob/main/docs/guide.md'));
    expect(plan.urls.map((u) => u.href)).toEqual(['https://raw.githubusercontent.com/a/b/main/docs/guide.md']);
    expect(plan.name).toBe('guide.md');
  });

  it('reads Wikipedia articles through the API', () => {
    const plan = planLink(new URL('https://fr.m.wikipedia.org/wiki/Soie_d%27araign%C3%A9e'));
    const api = plan.urls[0];
    expect(api.origin).toBe('https://fr.wikipedia.org');
    expect(api.searchParams.get('page')).toBe("Soie_d'araignée");
    expect(api.searchParams.get('origin')).toBe('*');
    expect(plan.name).toBe("Soie d'araignée");
    const html = plan.transform!(enc(JSON.stringify({ parse: { title: "Soie d'araignée", text: '<p>La soie…</p>' } })));
    expect(html).toContain("<h1>Soie d'araignée</h1><p>La soie…</p>");
  });

  it('leaves other sites alone', () => {
    const url = new URL('https://example.com/a.pdf');
    expect(planLink(url)).toEqual({ urls: [url] });
    expect(planLink(new URL('https://en.wikipedia.org/wiki/Special:Random')).urls[0].hostname).toBe('en.wikipedia.org');
    expect(planLink(new URL('https://en.wikipedia.org/wiki/Special:Random')).transform).toBeUndefined();
  });

  it('reports Wikipedia errors', () => {
    expect(() => wikipediaToHtml(enc(JSON.stringify({ error: { info: "The page you specified doesn't exist." } })))).toThrow(/doesn't exist/);
  });
});

describe('extForResponse', () => {
  const u = (p: string) => new URL(`https://example.com${p}`);
  it('trusts the content type first', () => {
    expect(extForResponse('application/pdf', u('/download?id=3'))).toBe('pdf');
    expect(extForResponse('text/html; charset=utf-8', u('/post.php'))).toBe('html');
    expect(extForResponse('text/markdown', u('/x'))).toBe('md');
  });
  it('falls back on the extension for generic types', () => {
    expect(extForResponse('text/plain; charset=utf-8', u('/README.md'))).toBe('md');
    expect(extForResponse('text/plain', u('/main.rs'))).toBe('rs');
    expect(extForResponse('application/octet-stream', u('/paper.pdf'))).toBe('pdf');
    expect(extForResponse('text/plain', u('/notes'))).toBe('txt');
  });
});

describe('names', () => {
  it('uses the page title, decoded', () => {
    expect(htmlTitle('<html><head><title>\n  Silk &amp; webs &#8212; a guide </title></head>')).toBe('Silk & webs — a guide');
    expect(htmlTitle('<p>no title</p>')).toBeNull();
    expect(nameForLink(new URL('https://example.com/a'), 'html', enc('<title>Hello</title>'))).toBe('Hello');
  });
  it('falls back on the file name, then the site', () => {
    expect(nameForLink(new URL('https://example.com/files/My%20paper.pdf'), 'pdf', enc('%PDF'))).toBe('My paper.pdf');
    expect(nameForLink(new URL('https://www.example.com/'), 'html', enc('<p>hi</p>'))).toBe('example.com');
    expect(nameForLink(new URL('https://example.com/'), 'html', enc(''), 'Hint')).toBe('Hint');
  });
});
