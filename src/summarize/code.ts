import type { Keyword } from './keywords';
import type { CodeFacts, Summary, SummarySentence } from './types';

const LANGUAGE_NAMES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript (React)', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript (React)', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift',
  cs: 'C#', c: 'C', h: 'C header', cpp: 'C++', cc: 'C++', hpp: 'C++ header', rb: 'Ruby', php: 'PHP',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL', css: 'CSS', scss: 'SCSS', less: 'Less',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', lua: 'Lua', dart: 'Dart', scala: 'Scala',
  vue: 'Vue', svelte: 'Svelte', ex: 'Elixir', exs: 'Elixir', hs: 'Haskell', clj: 'Clojure', r: 'R',
  jl: 'Julia', zig: 'Zig', nim: 'Nim', ml: 'OCaml', fs: 'F#', vb: 'Visual Basic', ps1: 'PowerShell',
};

export const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_NAMES));

export const codeLanguageName = (ext: string): string => LANGUAGE_NAMES[ext.toLowerCase()] ?? 'source';

type DeclKind = 'class' | 'function' | 'type';

interface Decl {
  kind: DeclKind;
  name: string;
  line: number;
  start: number;
  end: number;
  exported: boolean;
}

// Ordered: first match wins for a line.
const DECLARATIONS: Array<[RegExp, DeclKind]> = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:public\s+|private\s+|internal\s+|sealed\s+|data\s+|open\s+|final\s+|static\s+)*(?:class|struct|enum|trait|protocol|object|record)\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+|extern\s+"[^"]*"\s+)*fn\s+([A-Za-z_][\w]*)/, 'function'],
  [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, 'function'],
  [/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, 'function'],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, 'function'],
  [/^\s*(?:(?:public|private|protected|internal|static|override|virtual|abstract|final|async|suspend|open|inline)\s+)+(?:fun\s+)?(?:[\w<>[\],?\s]+\s+)?([A-Za-z_][\w]*)\s*\(/, 'function'],
  [/^\s*fun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?([A-Za-z_][\w]*)\s*\(/, 'function'],
  [/^\s{2,4}(?:async\s+|static\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/, 'function'],
];

const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'with', 'match', 'constructor']);

const KEYWORDS = new Set(
  `abstract and any arguments array as assert async await bool boolean break byte case catch char class const constructor continue crate
  def default defer del delete do double dyn elif else enum except export extends extern false final finally float fn for foreach from
  func function go goto if impl implements import in include instanceof int interface internal is lambda let long loop match mod module
  mut namespace native new nil none null number object of open override package pass private protected pub public raise readonly record
  ref require return self short static str string struct super switch synchronized this throw throws trait true try type typeof uint
  undefined union unsafe use using val var void volatile where while with yield console log print println printf len map filter reduce
  push pop get set value values key keys item items data result results error err args argv kwargs props state ctx context index idx
  tmp temp foo bar baz main init options opts config cfg util utils test tests expect describe it should equal math json object
  promise date window document process module exports symbol regexp infinity nan isnan parseint parsefloat settimeout
  cleartimeout requestanimationframe console boolean`.split(/\s+/),
);

/** Summarize a source file: what it declares, how big it is, and which names it talks about most. */
export function summarizeCode(text: string, ext = ''): Summary {
  const language = codeLanguageName(ext);
  const lines: Array<{ text: string; start: number }> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, start: offset });
    offset += line.length + 1;
  }

  const decls: Decl[] = [];
  let comments = 0;
  let todos = 0;
  let imports = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    const trimmed = t.trim();
    if (/^(?:\/\/|#(?!include|!)|\/\*|\*|--|;|""")/.test(trimmed)) comments++;
    if (/\b(?:TODO|FIXME|HACK|XXX)\b/.test(t)) todos++;
    if (/^\s*(?:import\b|from\s+\S+\s+import\b|#include\b|using\s+[\w.]+;|use\s+[\w:]+|require\(|.*=\s*require\()/.test(t)) imports++;
    for (const [re, kind] of DECLARATIONS) {
      const m = t.match(re);
      if (m && m[1] && !NOT_FUNCTIONS.has(m[1])) {
        const lead = t.length - t.trimStart().length;
        decls.push({
          kind,
          name: m[1],
          line: i,
          start: lines[i].start + lead,
          end: lines[i].start + t.trimEnd().length,
          exported: /^\s*(?:export|pub\b|public\b)/.test(t),
        });
        break;
      }
    }
  }

  const facts: CodeFacts = {
    language,
    lines: lines.length,
    functions: decls.filter((d) => d.kind === 'function').length,
    classes: decls.filter((d) => d.kind === 'class').length,
    types: decls.filter((d) => d.kind === 'type').length,
    imports,
    comments,
    todos,
  };

  // Pick up to 8 declarations, favoring classes/exports, spread over the file.
  const maxPoints = 8;
  const weighted = decls.map((d, i) => ({ d, w: (d.kind === 'class' ? 3 : d.kind === 'type' ? 1.5 : 1) + (d.exported ? 1.5 : 0) + (i === 0 ? 0.5 : 0) }));
  let chosen: Decl[];
  if (weighted.length <= maxPoints) {
    chosen = decls;
  } else {
    const bucketSize = lines.length / maxPoints;
    const picks = new Set<Decl>();
    for (let b = 0; b < maxPoints; b++) {
      const inBucket = weighted.filter(({ d }) => d.line >= b * bucketSize && d.line < (b + 1) * bucketSize);
      inBucket.sort((a, z) => z.w - a.w);
      if (inBucket[0]) picks.add(inBucket[0].d);
    }
    for (const { d } of [...weighted].sort((a, z) => z.w - a.w)) {
      if (picks.size >= maxPoints) break;
      picks.add(d);
    }
    chosen = [...picks].sort((a, z) => a.line - z.line);
  }
  const ranked = [...chosen].sort((a, z) => (weighted.find((x) => x.d === z)?.w ?? 0) - (weighted.find((x) => x.d === a)?.w ?? 0));
  const points: SummarySentence[] = chosen.map((d) => ({
    start: d.start,
    end: d.end,
    text: text.slice(d.start, d.end),
    score: weighted.find((x) => x.d === d)?.w ?? 1,
    rank: ranked.indexOf(d),
    label: `${d.kind === 'type' ? 'type' : d.kind} ${d.name} (line ${d.line + 1})`,
  }));

  // Identifier frequency → keywords.
  const counts = new Map<string, Array<[number, number]>>();
  const idRe = /[A-Za-z_$][\w$]*/g;
  const stringOrComment = /(["'`])(?:\\.|(?!\1).)*\1|\/\/.*$|#.*$/gm;
  const masked = text.replace(stringOrComment, (s) => ' '.repeat(s.length));
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(masked))) {
    const id = m[0];
    if (id.length < 3 || KEYWORDS.has(id.toLowerCase()) || /^\d/.test(id)) continue;
    let occ = counts.get(id);
    if (!occ) counts.set(id, (occ = []));
    occ.push([m.index, m.index + id.length]);
  }
  const declNames = new Set(decls.map((d) => d.name));
  const keywords: Keyword[] = [...counts.entries()]
    .map(([id, occ]) => ({
      phrase: id,
      key: id.toLowerCase(),
      count: occ.length,
      occurrences: occ,
      score: occ.length * (declNames.has(id) ? 1.6 : 1) * Math.min(1.4, 0.7 + id.length / 12),
    }))
    .filter((k) => k.count >= 2)
    .sort((a, z) => z.score - a.score)
    .slice(0, 10);

  const headline = leadingDocComment(text);
  const parts: string[] = [];
  if (facts.functions) parts.push(`${facts.functions} function${facts.functions > 1 ? 's' : ''}`);
  if (facts.classes) parts.push(`${facts.classes} class${facts.classes > 1 ? 'es' : ''}`);
  if (facts.types) parts.push(`${facts.types} type${facts.types > 1 ? 's' : ''}`);
  const main = [...decls].sort((a, z) => (z.exported ? 1 : 0) - (a.exported ? 1 : 0) || (z.kind === 'class' ? 1 : 0) - (a.kind === 'class' ? 1 : 0)).slice(0, 3).map((d) => d.name);
  let tldr = `A ${language} file of ${lines.length} lines`;
  tldr += parts.length ? ` with ${joinList(parts)}.` : '.';
  if (main.length) tldr += ` Main pieces: ${joinList(main)}.`;
  if (todos) tldr += ` ${todos} TODO${todos > 1 ? 's' : ''} left behind.`;
  if (headline) tldr = `${headline} ${tldr}`;

  const words = (text.match(/[A-Za-z_$][\w$]*/g) ?? []).length;
  return {
    mode: 'code',
    language: 'code',
    tldr,
    points,
    keywords,
    code: facts,
    stats: {
      words,
      sentences: points.length,
      paragraphs: lines.length,
      characters: text.length,
      // Code reads slower than prose; ~50 lines per minute is a common rule of thumb.
      readingMinutes: lines.length / 50,
    },
  };
}

function leadingDocComment(text: string): string {
  const head = text.slice(0, 1500);
  const block = head.match(/^\s*(?:#!.*\n\s*)?(?:\/\*\*?([\s\S]*?)\*\/|((?:\s*\/\/.*\n)+)|("""[\s\S]*?"""|'''[\s\S]*?'''))/);
  if (!block) return '';
  const raw = (block[1] ?? block[2] ?? block[3] ?? '')
    .replace(/^\s*(?:\*|\/\/|"""|''')\s?/gm, '')
    .replace(/"""|'''/g, '')
    .replace(/@\w+.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length < 12) return '';
  const first = raw.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? raw;
  const sentence = first.trim().slice(0, 180);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
