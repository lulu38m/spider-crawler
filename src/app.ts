import { REPO_URL } from './config';
import { canvasMeasure } from './doc/layout';
import { ACCEPT, loadDocument, UnsupportedFileError, type LoadInput } from './doc/load';
import type { Doc } from './doc/types';
import { fetchLink, parseLink } from './doc/url';
import { Scene, type Phase } from './scene/scene';
import { SKINS, skinById } from './spider/skins';
import { summarizeAsync } from './summarize/client';
import { aiLabel, aiSummarize, DEFAULT_CLAUDE_MODEL, loadAiSettings, saveAiSettings, type AiSettings, type ProviderId } from './summarize/llm';
import type { Summary } from './summarize/types';
import { fileSafe, shareCard, summaryMarkdown } from './ui/export';
import { download, Recorder } from './ui/recorder';

type Frame = 'fill' | '16:9' | '9:16' | '1:1';
const FRAMES: Record<Exclude<Frame, 'fill'>, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
const SPEEDS = [0.5, 1, 2, 4];

interface Prefs {
  skin: string;
  speed: number;
  frame: Frame;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadPrefs(): Prefs {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fallback: Prefs = { skin: 'blueprint', speed: reduced ? 2 : 1, frame: 'fill' };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem('spider-crawler.prefs') ?? '{}') };
  } catch {
    return fallback;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem('spider-crawler.prefs', JSON.stringify(p));
  } catch {
    /* private mode: fine */
  }
}

export function startApp(): void {
  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();
  if (params.get('skin')) prefs.skin = params.get('skin')!;
  const urlSpeed = Number(params.get('speed'));
  if (urlSpeed >= 0.25 && urlSpeed <= 4) prefs.speed = urlSpeed;
  if (params.get('frame') && (params.get('frame') === 'fill' || params.get('frame')! in FRAMES)) prefs.frame = params.get('frame') as Frame;

  const app = $<HTMLElement>('app');
  const canvas = $<HTMLCanvasElement>('stage');
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const measure = canvasMeasure();
  const recorder = new Recorder();
  let ai: AiSettings = loadAiSettings();
  let current: { doc: Doc; summary: Summary } | null = null;
  let busy = false;
  /** Bumped when a load is superseded (going home, another file): late results are dropped. */
  let generation = 0;
  let aiAbort: AbortController | null = null;
  let autoStopRecording = false;
  let panelTimer = 0;

  const scene = new Scene(skinById(prefs.skin), {
    onPhase: (p) => onPhase(p),
    onFinaleSettled: () => {
      if (recorder.recording && autoStopRecording) window.setTimeout(() => void stopRecording(), 3000);
      else if (!recorder.recording) panelTimer = window.setTimeout(() => openSummary(), 900);
    },
  });
  scene.speed = prefs.speed;

  // ── Canvas sizing and framing ─────────────────────────────────────────

  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (prefs.frame === 'fill') {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      app.classList.remove('framed');
      scene.resize(vw, vh, dpr);
    } else {
      const [fw, fh] = FRAMES[prefs.frame];
      const pad = 16;
      const s = Math.min((vw - pad * 2) / fw, (vh - pad * 2 - 64) / fh);
      const cw = fw * s;
      const ch = fh * s;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      canvas.style.left = `${(vw - cw) / 2}px`;
      canvas.style.top = `${Math.max(pad, (vh - 64 - ch) / 2)}px`;
      canvas.width = fw;
      canvas.height = fh;
      app.classList.add('framed');
      scene.resize(fw, fh, 1);
    }
    fitIdlePanel();
  }

  /** Makes the landing sheet tall enough for the buttons under it (they don't shrink on phones). */
  function fitIdlePanel() {
    if (!scene.isIdle) return placeIdlePanel();
    const prev = idlePanel.style.minHeight;
    idlePanel.style.minHeight = '0px';
    const need = idlePanel.scrollHeight + 12;
    idlePanel.style.minHeight = prev;
    const k = canvas.getBoundingClientRect().width / scene.w;
    const before = scene.idle.controlsNeed;
    scene.idle.controlsNeed = need / k;
    if (Math.abs(before - scene.idle.controlsNeed) > 1) {
      scene.idle.layout(scene.w, scene.h, scene.camera);
      scene.camera.snap();
    }
    placeIdlePanel();
  }

  /** Canvas logical coordinates → window coordinates. */
  function toWindow(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (x / scene.w) * r.width, y: r.top + (y / scene.h) * r.height, k: r.width / scene.w };
  }

  function toCanvas(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * scene.w, y: ((clientY - r.top) / r.height) * scene.h };
  }

  const idlePanel = $<HTMLElement>('idle-panel');
  function placeIdlePanel() {
    const rect = scene.idle.controlsRect(scene.camera, scene.w, scene.h);
    const a = toWindow(rect.x, rect.y);
    const b = toWindow(rect.x + rect.w, rect.y + rect.h);
    const zoom = scene.camera.zoom * a.k;
    const pad = 64 * zoom;
    idlePanel.style.setProperty('--panel-x', `${a.x + pad}px`);
    idlePanel.style.setProperty('--panel-y', `${a.y}px`);
    idlePanel.style.setProperty('--panel-w', `${b.x - a.x - pad * 2}px`);
    idlePanel.style.setProperty('--panel-h', `${b.y - a.y}px`);
    idlePanel.style.setProperty('--panel-scale', String(Math.max(0.6, zoom)));
  }

  window.addEventListener('resize', layout);
  layout();

  // ── Main loop ─────────────────────────────────────────────────────────

  const capture = params.has('capture');
  let placeHome = () => {};
  if (params.get('hideui') === '1') {
    app.classList.add('bare');
    scene.idle.decor = true;
  }
  // Text measured before the web fonts arrive is wrong: drop cached line breaks when they land.
  document.fonts?.addEventListener('loadingdone', () => scene.fontsChanged());
  if (!capture) {
    let last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      scene.update(dt);
      scene.render(ctx);
      placeHome();
      if (recorder.recording) $('rec-time').textContent = formatTime((performance.now() - recorder.startedAt) / 1000);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ── Phases ────────────────────────────────────────────────────────────

  const controls = $<HTMLElement>('controls');
  const skipBtn = $<HTMLButtonElement>('skip-btn');
  const summaryBtn = $<HTMLButtonElement>('summary-btn');
  const topbar = document.querySelector<HTMLElement>('.topbar')!;

  // While crawling, the controls and top bar fade out when the pointer rests, like a video player.
  let dimTimer = 0;
  function wake() {
    controls.classList.remove('dim');
    topbar.classList.remove('dim');
    window.clearTimeout(dimTimer);
    if (scene.phase !== 'crawl' && scene.phase !== 'leaving') return;
    dimTimer = window.setTimeout(() => {
      if (controls.matches(':hover, :focus-within')) return wake();
      controls.classList.add('dim');
      topbar.classList.add('dim');
    }, 2600);
  }
  window.addEventListener('pointermove', wake);
  window.addEventListener('keydown', wake);
  controls.addEventListener('focusin', wake);

  function onPhase(p: Phase) {
    const idle = p === 'idle' || p === 'loading';
    idlePanel.hidden = !idle;
    idlePanel.toggleAttribute('inert', p === 'loading');
    controls.hidden = idle && !recorder.recording;
    skipBtn.hidden = p === 'finale';
    summaryBtn.hidden = p !== 'finale';
    if (idle) {
      closeSummary();
      fitIdlePanel();
    }
    canvas.setAttribute(
      'aria-label',
      p === 'crawl' ? `A spider crawling ${current?.doc.name ?? 'the document'}` : p === 'finale' ? 'The spider spinning its summary into a web' : 'A spider walking on a sheet of paper',
    );
    if (p === 'finale') announce('The spider finished reading. The summary is ready.');
    wake();
  }

  // ── Loading documents ─────────────────────────────────────────────────

  async function open(input: LoadInput) {
    if (busy) return;
    busy = true;
    const gen = ++generation;
    window.clearTimeout(panelTimer);
    aiAbort?.abort();
    setPaused(false);
    if (scene.phase !== 'idle' && scene.phase !== 'loading') scene.reset();
    closeSummary();
    const title = `Reading ${input.name}…`;
    scene.setLoading(title, 'Unrolling the pages.');
    try {
      const doc = await loadDocument(input, measure, (msg) => gen === generation && scene.setLoading(title, msg));
      if (gen !== generation) return doc.dispose?.();
      if (doc.text.replace(/\s/g, '').length < 40) {
        throw new UnsupportedFileError(doc.warnings[0] ?? 'The spider needs at least a few sentences to read.');
      }
      scene.setLoading(title, 'Sniffing out what matters.');
      const summary = await summarizeAsync(doc.text, {
        mode: doc.kind === 'code' ? 'code' : 'prose',
        codeExtension: doc.codeExtension,
        headings: doc.headings,
      });
      if (gen !== generation) return doc.dispose?.();
      for (const w of doc.warnings) toast(w);
      current = { doc, summary };
      renderSummary();
      void runAi(doc, summary);
      if (params.get('record') === '1' && Recorder.supported() && !recorder.recording) startRecording(true);
      // Deep-linked captures start on the page; otherwise the spider leaps off the sheet first.
      if (capture && params.has('sample')) scene.startNow(doc, summary);
      else scene.start(doc, summary);
    } catch (err) {
      if (gen !== generation) return;
      console.error(err);
      scene.reset();
      toast(err instanceof UnsupportedFileError ? err.message : `The spider couldn't read this file: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      if (gen === generation) busy = false;
    }
  }

  async function openFile(file: File) {
    const data = await file.arrayBuffer();
    await open({ name: file.name, data });
  }

  async function openSample(name: string) {
    if (name === 'code') {
      // The code that spins the dragline: the spider reading the source of its own silk.
      const { default: source } = await import('./scene/trail.ts?raw');
      return open({ name: 'trail.ts', data: source });
    }
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await open({ name, data: await res.arrayBuffer() });
    } catch (err) {
      toast(`Couldn't load the sample (${err instanceof Error ? err.message : err}).`, true);
    }
  }

  async function openLink(url: URL) {
    if (busy) return;
    busy = true;
    const gen = ++generation;
    window.clearTimeout(panelTimer);
    aiAbort?.abort();
    setPaused(false);
    if (scene.phase !== 'idle' && scene.phase !== 'loading') scene.reset();
    closeSummary();
    const host = url.hostname.replace(/^www\./, '');
    scene.setLoading(`Fetching ${host}…`, 'Following the thread to the page.');
    let input: LoadInput;
    try {
      input = await fetchLink(url);
    } catch (err) {
      if (gen !== generation) return;
      console.error(err);
      scene.reset();
      toast(err instanceof UnsupportedFileError ? err.message : `The spider couldn't fetch this link: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    } finally {
      if (gen === generation) busy = false;
    }
    if (gen !== generation) return;
    await open(input);
  }

  /** The file given to the CLI (`npx @lulu38m/spider-crawler notes.pdf`). */
  async function openLocalFile() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/file`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'document');
      await open({ name, data: await res.arrayBuffer() });
    } catch (err) {
      toast(`Couldn't open the file from the command line (${err instanceof Error ? err.message : err}).`, true);
    }
  }

  // ── AI summary (optional) ─────────────────────────────────────────────

  const aiReady = (s: AiSettings) => (s.provider === 'anthropic' && !!s.apiKey) || (s.provider === 'openai' && !!s.model);

  async function runAi(doc: Doc, summary: Summary) {
    if (!aiReady(ai)) return;
    aiAbort = new AbortController();
    const label = aiLabel(ai);
    setAiStatus(`Asking ${label}…`);
    try {
      const res = await aiSummarize(doc.name, doc.text, ai, aiAbort.signal);
      if (current?.summary !== summary) return;
      summary.ai = res;
      scene.setAiTldr(res.tldr);
      renderSummary();
    } catch (err) {
      if (aiAbort?.signal.aborted) return;
      setAiStatus(`${label} didn't answer: ${err instanceof Error ? err.message : err}`);
      toast(`AI summary failed. The offline summary is still there.`, true);
    }
  }

  function setAiStatus(text: string) {
    $('summary-ai').hidden = false;
    $('summary-ai-title').textContent = 'AI summary';
    $('summary-ai-status').textContent = text;
    $('summary-ai-points').replaceChildren();
  }

  function refreshAiChip() {
    $('ai-state').textContent = aiReady(ai) ? aiLabel(ai) : 'off';
  }
  refreshAiChip();

  // ── Summary panel ─────────────────────────────────────────────────────

  const summaryEl = $<HTMLElement>('summary');

  function renderSummary() {
    if (!current) return;
    const { doc, summary } = current;
    $('summary-file').textContent = doc.name;
    $('summary-tldr').textContent = summary.tldr;
    const aiBlock = $('summary-ai');
    if (summary.ai) {
      aiBlock.hidden = false;
      $('summary-ai-title').textContent = `Rewritten by ${summary.ai.provider} (${summary.ai.model})`;
      $('summary-ai-status').textContent = summary.ai.tldr;
      $('summary-ai-points').replaceChildren(...summary.ai.points.map((p) => li(p)));
    } else if (!aiReady(ai)) {
      aiBlock.hidden = true;
    }
    $('points-title').textContent = summary.mode === 'code' ? 'Main declarations' : 'Key sentences, in document order';
    const points = summary.points.map((p) => {
      const item = document.createElement('li');
      if (summary.mode === 'code') {
        const code = document.createElement('code');
        code.textContent = p.text.trim();
        item.append(`${p.label ?? ''}: `, code);
      } else item.textContent = p.text;
      return item;
    });
    if (!points.length) points.push(li('The document is short enough that the gist above is all of it.'));
    $('summary-points').replaceChildren(...points);
    $('summary-keywords').replaceChildren(
      ...summary.keywords.map((k) => {
        const span = document.createElement('span');
        span.textContent = k.phrase;
        return span;
      }),
    );
    const s = summary.stats;
    const minutes = s.readingMinutes < 1 ? 'under a minute' : `about ${Math.round(s.readingMinutes)} min`;
    $('summary-stats').textContent =
      summary.mode === 'code'
        ? `${summary.code?.language} file, ${fmtInt(summary.code?.lines ?? 0)} lines: ${minutes} to read.`
        : `${fmtInt(s.words)} words in ${fmtInt(s.sentences)} sentences: ${minutes} of reading. Language: ${languageName(summary.language)}.`;
  }

  function li(text: string) {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }

  function openSummary() {
    if (!current) return;
    renderSummary();
    summaryEl.hidden = false;
    summaryBtn.textContent = 'Hide summary';
  }

  function closeSummary() {
    summaryEl.hidden = true;
    summaryBtn.textContent = 'Show summary';
  }

  $('summary-close').addEventListener('click', closeSummary);
  summaryBtn.addEventListener('click', () => (summaryEl.hidden ? openSummary() : closeSummary()));

  $('copy-md').addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(summaryMarkdown(current.doc.name, current.summary, current.doc.source));
      toast('Summary copied as Markdown.');
    } catch {
      toast('Copying was blocked by the browser. Use Download .md instead.', true);
    }
  });
  $('dl-md').addEventListener('click', () => {
    if (!current) return;
    download(new Blob([summaryMarkdown(current.doc.name, current.summary, current.doc.source)], { type: 'text/markdown' }), `${fileSafe(current.doc.name)}-gist.md`);
  });
  $('dl-png').addEventListener('click', async () => {
    if (!current) return;
    const blob = await shareCard(current.doc.name, current.summary, current.summary.ai?.tldr ?? current.summary.tldr);
    download(blob, `${fileSafe(current.doc.name)}-spider-crawler.png`);
  });
  $('again-btn').addEventListener('click', () => {
    goHome();
    $<HTMLInputElement>('file-input').click();
  });

  // ── Controls ──────────────────────────────────────────────────────────

  const pauseBtn = $<HTMLButtonElement>('pause-btn');
  function setPaused(p: boolean) {
    scene.paused = p;
    pauseBtn.setAttribute('aria-pressed', String(p));
    pauseBtn.querySelector('.label')!.textContent = p ? 'Play' : 'Pause';
  }
  pauseBtn.addEventListener('click', () => setPaused(!scene.paused));

  const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('.seg [data-speed]')];
  function setSpeed(v: number) {
    scene.speed = v;
    prefs.speed = v;
    savePrefs(prefs);
    for (const b of speedButtons) b.setAttribute('aria-checked', String(Number(b.dataset.speed) === v));
  }
  speedButtons.forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
  setSpeed(prefs.speed);

  const skinSelect = $<HTMLSelectElement>('skin-select');
  for (const s of SKINS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    opt.title = s.blurb;
    skinSelect.append(opt);
  }
  function setSkin(id: string) {
    const skin = skinById(id);
    scene.setSkin(skin);
    skinSelect.value = skin.id;
    prefs.skin = skin.id;
    savePrefs(prefs);
  }
  skinSelect.addEventListener('change', () => setSkin(skinSelect.value));
  setSkin(prefs.skin);

  const frameSelect = $<HTMLSelectElement>('frame-select');
  frameSelect.value = prefs.frame;
  frameSelect.addEventListener('change', () => {
    prefs.frame = frameSelect.value as Frame;
    savePrefs(prefs);
    layout();
  });

  skipBtn.addEventListener('click', () => scene.skip());
  /** Back to the landing sheet (logo, New document button, N key). */
  function goHome() {
    // Drop any file or link still loading, and never come back to a paused sheet.
    generation++;
    busy = false;
    aiAbort?.abort();
    window.clearTimeout(panelTimer);
    setPaused(false);
    closeSummary();
    scene.reset();
  }
  $('new-btn').addEventListener('click', goHome);

  // The logo is drawn on the canvas (so it shows in recordings); an invisible button sits on top of it.
  const homeBtn = $<HTMLButtonElement>('home-btn');
  homeBtn.addEventListener('click', goHome);
  let homeKey = '';
  placeHome = () => {
    const r = scene.hud.logoRect;
    if (!r) return;
    const a = toWindow(r.x, r.y);
    const b = toWindow(r.x + r.w, r.y + r.h);
    const key = `${a.x}|${a.y}|${b.x}|${b.y}`;
    if (key === homeKey) return;
    homeKey = key;
    Object.assign(homeBtn.style, { left: `${a.x - 6}px`, top: `${a.y - 4}px`, width: `${b.x - a.x + 12}px`, height: `${b.y - a.y + 8}px` });
  };

  // ── Recording ─────────────────────────────────────────────────────────

  const recBtn = $<HTMLButtonElement>('rec-btn');
  if (!Recorder.supported()) {
    recBtn.disabled = true;
    recBtn.title = 'Recording is not supported in this browser';
  }

  function startRecording(auto: boolean) {
    try {
      recorder.start(canvas, 60);
    } catch (err) {
      toast(`Recording failed to start: ${err instanceof Error ? err.message : err}`, true);
      return;
    }
    autoStopRecording = auto || scene.phase === 'crawl' || scene.phase === 'leaving' || scene.phase === 'idle' || scene.phase === 'loading';
    recBtn.setAttribute('aria-pressed', 'true');
    recBtn.querySelector('.label')!.textContent = 'Stop';
    frameSelect.disabled = true;
    $('rec-badge').hidden = false;
    toast(scene.phase === 'finale' ? 'Recording.' : 'Recording. It stops by itself a few seconds after the summary is spun.');
  }

  async function stopRecording() {
    if (!recorder.recording) return;
    const { blob, extension } = await recorder.stop();
    recBtn.setAttribute('aria-pressed', 'false');
    recBtn.querySelector('.label')!.textContent = 'Record';
    frameSelect.disabled = false;
    $('rec-badge').hidden = true;
    const name = `spider-crawler-${current ? fileSafe(current.doc.name) : 'idle'}.${extension}`;
    download(blob, name);
    toast(`Saved ${name}.`);
    if (scene.phase === 'finale') openSummary();
    if (scene.phase === 'idle') controls.hidden = true;
  }

  recBtn.addEventListener('click', () => (recorder.recording ? void stopRecording() : startRecording(false)));

  // ── Inputs: file picker, drag and drop, paste ─────────────────────────

  const fileInput = $<HTMLInputElement>('file-input');
  fileInput.accept = ACCEPT;
  $('pick-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void openFile(f);
    fileInput.value = '';
  });

  document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) => b.addEventListener('click', () => void openSample(b.dataset.sample!)));

  const dropHint = $<HTMLElement>('drop-hint');
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (scene.isIdle) scene.setDrag(true);
    else dropHint.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      scene.setDrag(false);
      dropHint.hidden = true;
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    scene.setDrag(false);
    dropHint.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) return void openFile(f);
    // A link dragged from another tab or the address bar.
    const uri = (e.dataTransfer?.getData('text/uri-list') ?? '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    const link = uri ? parseLink(uri) : null;
    if (link) void openLink(link);
  });

  const urlInput = $<HTMLInputElement>('url-input');
  $<HTMLFormElement>('url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = urlInput.value.trim();
    if (!value) return urlInput.focus();
    const link = parseLink(value);
    if (!link) {
      toast("That doesn't look like a link. Try something like https://example.com/article.", true);
      return;
    }
    urlInput.value = '';
    urlInput.blur();
    void openLink(link);
  });

  const pasteDialog = $<HTMLDialogElement>('paste-dialog');
  $('paste-btn').addEventListener('click', () => {
    $<HTMLTextAreaElement>('paste-text').value = '';
    $<HTMLInputElement>('paste-name').value = '';
    pasteDialog.showModal();
  });
  pasteDialog.addEventListener('close', () => {
    if (pasteDialog.returnValue !== 'ok') return;
    const text = $<HTMLTextAreaElement>('paste-text').value;
    const title = $<HTMLInputElement>('paste-name').value.trim() || 'Pasted text';
    if (text.trim()) void open({ name: `${title}.${/^#{1,6}\s/m.test(text) ? 'md' : 'txt'}`, data: text });
  });

  window.addEventListener('paste', (e) => {
    if (!scene.isIdle || busy || (e.target as HTMLElement)?.closest('dialog, input, textarea')) return;
    const file = e.clipboardData?.files?.[0];
    if (file) {
      e.preventDefault();
      void openFile(file);
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const link = parseLink(text);
    if (link) {
      e.preventDefault();
      void openLink(link);
      return;
    }
    if (text.trim().length > 60) {
      e.preventDefault();
      void open({ name: /^#{1,6}\s/m.test(text) ? 'Pasted text.md' : 'Pasted text.txt', data: text });
    }
  });

  // ── AI settings dialog ────────────────────────────────────────────────

  const aiDialog = $<HTMLDialogElement>('ai-dialog');
  const aiForm = $<HTMLFormElement>('ai-form');
  const providerInputs = [...aiForm.querySelectorAll<HTMLInputElement>('input[name=provider]')];
  const syncAiFields = () => {
    const provider = providerInputs.find((i) => i.checked)?.value ?? 'off';
    aiForm.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => (el.hidden = !el.dataset.for!.split(' ').includes(provider)));
    $<HTMLInputElement>('ai-model').placeholder = provider === 'anthropic' ? DEFAULT_CLAUDE_MODEL : 'e.g. llama3.2 or gpt-4o-mini';
  };
  providerInputs.forEach((i) => i.addEventListener('change', syncAiFields));
  $('ai-btn').addEventListener('click', () => {
    providerInputs.forEach((i) => (i.checked = i.value === ai.provider));
    $<HTMLInputElement>('ai-key').value = ai.apiKey;
    $<HTMLInputElement>('ai-model').value = ai.model;
    $<HTMLInputElement>('ai-base').value = ai.baseUrl;
    syncAiFields();
    aiDialog.showModal();
  });
  aiDialog.addEventListener('close', () => {
    if (aiDialog.returnValue !== 'ok') return;
    ai = {
      provider: (providerInputs.find((i) => i.checked)?.value ?? 'off') as ProviderId,
      apiKey: $<HTMLInputElement>('ai-key').value.trim(),
      model: $<HTMLInputElement>('ai-model').value.trim(),
      baseUrl: $<HTMLInputElement>('ai-base').value.trim() || 'https://api.openai.com/v1',
    };
    saveAiSettings(ai);
    refreshAiChip();
    if (ai.provider === 'openai' && !ai.model) toast('Add a model name to use an OpenAI-compatible provider.', true);
    else if (ai.provider === 'anthropic' && !ai.apiKey) toast('Add your Anthropic API key to use Claude.', true);
    else if (aiReady(ai) && current && !current.summary.ai) void runAi(current.doc, current.summary);
    else if (aiReady(ai)) toast(`AI summary on: ${aiLabel(ai)}.`);
  });

  // ── Pointer and keyboard ──────────────────────────────────────────────

  canvas.addEventListener('pointermove', (e) => scene.pointer(toCanvas(e.clientX, e.clientY)));
  canvas.addEventListener('pointerleave', () => scene.pointer(null));
  canvas.addEventListener('pointerdown', (e) => scene.click(toCanvas(e.clientX, e.clientY)));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement)?.closest('input, textarea, select, dialog')) return;
    const playing = scene.phase === 'crawl' || scene.phase === 'finale' || scene.phase === 'leaving';
    switch (e.key) {
      case ' ':
        if (playing) {
          e.preventDefault();
          setPaused(!scene.paused);
        }
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const i = SPEEDS.indexOf(scene.speed);
        setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]);
        break;
      }
      case 's':
      case 'S': {
        const i = SKINS.findIndex((s) => s.id === prefs.skin);
        setSkin(SKINS[(i + 1) % SKINS.length].id);
        toast(SKINS[(i + 1) % SKINS.length].name);
        break;
      }
      case 'r':
      case 'R':
        if (Recorder.supported()) recorder.recording ? void stopRecording() : startRecording(false);
        break;
      case 'k':
      case 'K':
        scene.skip();
        break;
      case 'n':
      case 'N':
        goHome();
        break;
      case 'Escape':
        closeSummary();
        break;
    }
  });

  // ── Misc ──────────────────────────────────────────────────────────────

  const gh = $<HTMLAnchorElement>('gh-link');
  gh.href = REPO_URL;

  const toasts = $<HTMLElement>('toasts');
  function toast(message: string, error = false) {
    const el = document.createElement('div');
    el.className = `toast${error ? ' error' : ''}`;
    el.textContent = message;
    toasts.append(el);
    window.setTimeout(() => el.remove(), error ? 6500 : 3600);
  }
  function announce(message: string) {
    toast(message);
  }

  onPhase(scene.phase);

  // Deep links: ?sample=spider-silk.md, ?url=https://… and ?local=1 (a file given to the CLI) start right away.
  const sample = params.get('sample');
  const deepLink = params.get('url');
  if (sample) void openSample(sample);
  else if (deepLink) {
    const link = parseLink(deepLink);
    if (link) void openLink(link);
    else toast("The link in this page's address isn't valid.", true);
  } else if (params.get('local') === '1') void openLocalFile();

  // Scripted, frame-perfect rendering (scripts/render-demo.mjs).
  if (capture) {
    const fps = Number(params.get('fps') ?? 30);
    const api = {
      get phase() {
        return scene.phase;
      },
      /** Words currently falling (or healing): lets scripts find the moment. */
      get falling() {
        return scene.falling?.items.length ?? 0;
      },
      get settled() {
        return scene.phase === 'finale' && scene.finale !== null && scene.finale.elapsed(scene.time) > 9;
      },
      async preload() {
        await document.fonts.ready;
        await scene.preload();
      },
      step(frames = 1) {
        for (let i = 0; i < frames; i++) scene.update(1 / fps);
        scene.render(ctx);
      },
      frame(type = 'image/jpeg', quality = 0.92) {
        return canvas.toDataURL(type, quality);
      },
      pointer(x: number, y: number) {
        scene.pointer({ x, y });
      },
      open: (name: string) => openSample(name),
    };
    (window as unknown as { __spider: typeof api }).__spider = api;
  }

}

const intFmt = new Intl.NumberFormat('en');
const fmtInt = (n: number) => intFmt.format(n);

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
