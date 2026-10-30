# Contributing to Spider Crawler

Thanks for helping the spider read better. Small, focused pull requests are the easiest to review.

## Setup

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest
npm run typecheck
npm run build        # type-check + production build into dist/
npm start            # run the built app like `npx @lulu38m/spider-crawler`
```

Node 22 or newer. Open http://localhost:5173/playground.html to work on the spider without loading a document (move the mouse, click to jump, keys 1–6 switch skins).

## Good first contributions

### A new spider

Every spider is drawn as its own rig, so a skin is just data. Add an entry to `SKINS` in [`src/spider/skins.ts`](src/spider/skins.ts):

```ts
{
  id: 'disco',
  name: 'Disco',
  blurb: 'Mirror-ball body, rainbow legs.',
  scale: 1.1,
  legLength: 1,
  legWidth: 1,
  abdomen: { length: 1, width: 1 },
  body: 'circle',          // ellipse | rect | hex | diamond | circle
  joints: 'diamond',       // circle | square | diamond
  eyes: 'pair',            // pair | visor | cyclops | quad
  colors: {
    legs: ['#ff3d7f', '#3dd6ff'], // the two gait groups
    ink: '#9b6bff',
    fill: 'rgba(155, 107, 255, 0.2)',
    eye: '#14002a',
    accent: '#ffe14d',
  },
  glow: 0.6,
  halo: false,
},
```

It appears in the picker right away. New body shapes, joints or eyes go in [`src/spider/draw.ts`](src/spider/draw.ts). Please include a screenshot in the pull request.

### Your language

Summaries detect the document's language from its stopwords. Adding a language means adding a stopword list (and optionally a few generic words) in [`src/summarize/stopwords.ts`](src/summarize/stopwords.ts), plus the words that make a sentence lean on context in `DANGLING_STARTS` in [`src/summarize/index.ts`](src/summarize/index.ts). Add a short test in `tests/summarize.test.ts` with a paragraph in your language.

### Financial metrics

Finance mode lives in [`src/summarize/finance.ts`](src/summarize/finance.ts). Each metric is a few lines in `METRICS`: its names in each language, its unit (money, percent, per share, multiple) and its rank. A metric your reports use is missing, or its name in your language? Add it, with a sentence from a (public or made-up) report in `tests/finance.test.ts`.

### A file format

Every format is converted to blocks (headings, paragraphs, list items, code) and typeset by [`src/doc/layout.ts`](src/doc/layout.ts), or, for fixed layouts like PDF, to positioned words directly. See [`src/doc/load.ts`](src/doc/load.ts) for how formats are detected. EPUB and OpenDocument are wanted.

## How the code is organized

| Folder | What lives there |
| --- | --- |
| `src/doc` | Parsers and the page layout engine. Everything becomes `Doc` → pages → lines → words, each word with a box and a char range in `Doc.text`. |
| `src/summarize` | The offline summarizer (TextRank, MMR, keyphrases, code mode) and the optional AI providers. Pure functions, runs in a worker. |
| `src/spider` | The spider: IK solver, gait, skins, drawing. No knowledge of documents. |
| `src/scene` | The show: camera, pages, director (choreography), silk, cocoons, orb web, HUD, finale. |
| `src/ui` | Recorder, exports, share image. |
| `src/app.ts` | DOM wiring. |
| `server` | The local link fetcher used by the CLI, Docker and `npm run dev`. Plain Node, no dependencies. |
| `bin` | The `spider-crawler` command. |

Two rules keep the project honest:

1. **What the spider shows is what the analysis found.** Highlights are summary sentences, cocoons are keywords. Don't add effects that pretend.
2. **Everything visible is drawn on the canvas**, so recordings match the screen. DOM is only for controls.

## Style

- TypeScript, strict mode, no UI framework.
- Comments explain *why*, not *what*.
- Prettier settings are in `.prettierrc` (single quotes, 140 columns).
- UI copy: short, plain, sentence case, no exclamation marks.

## Reporting a bug

Use the bug template. If a specific file breaks the spider, a similar file you can share is gold. Please never attach anything private.
