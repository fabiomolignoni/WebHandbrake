/**
 * In-page overlay in a closed shadow root, isolated from the site's styles.
 * Accessible: role=timer with polite announcements once per minute, visible focus,
 * reduced motion respected, draggable with mouse, touch and keyboard.
 */

import { formatMessage } from '../i18n/icu';
import type { TickResponse } from '../shared/models';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.chip {
  position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 12px; border-radius: 999px; color: #f7f7f5; background: rgba(28, 33, 38, var(--o, .94));
  box-shadow: 0 4px 18px rgba(0,0,0,.25); font-size: 13px; line-height: 1.2; max-width: min(420px, calc(100vw - 24px));
  touch-action: none; user-select: none;
}
.chip.small { font-size: 12px; } .chip.large { font-size: 16px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.time { font-variant-numeric: tabular-nums; font-weight: 650; }
.label { opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button {
  all: unset; cursor: pointer; border-radius: 999px; min-width: 24px; min-height: 24px; display: inline-grid; place-items: center;
  padding: 2px 8px; color: inherit; font: inherit; font-size: .9em; background: rgba(255,255,255,.12);
}
button:hover { background: rgba(255,255,255,.22); }
button:focus-visible { outline: 2px solid #a6b2f4; outline-offset: 2px; }
.handle { cursor: grab; padding: 0 2px; opacity: .6; font-size: 14px; }
.panel {
  position: fixed; pointer-events: auto; left: 50%; transform: translateX(-50%); bottom: 24px;
  width: min(560px, calc(100vw - 24px)); padding: 14px 16px; border-radius: 14px;
  color: #1d2327; background: #fbfaf7; box-shadow: 0 10px 40px rgba(0,0,0,.28); font-size: 14px; line-height: 1.45;
  border-top: 4px solid var(--c, #4850a5);
}
.panel h2 { margin: 0 0 4px; font-size: 15px; font-weight: 650; }
.panel p { margin: 0 0 8px; }
.panel .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.panel button { background: #e7ece9; color: #1d2327; padding: 6px 12px; }
.panel button.primary { background: #4850a5; color: #fff; }
.bar { height: 6px; border-radius: 3px; background: #e2e5e2; overflow: hidden; flex: 1; min-width: 120px; }
.bar > i { display: block; height: 100%; background: #4850a5; transition: width 1s linear; }
.top { top: 12px; bottom: auto; }
@media (prefers-color-scheme: dark) {
  .panel { color: #eceeea; background: #22282c; }
  .panel button { background: #343c41; color: #eceeea; }
  .bar { background: #3a4247; }
}
@media (prefers-reduced-motion: reduce) { .bar > i { transition: none; } }
.cover {
  position: fixed; inset: 0; width: auto; height: auto; max-width: none; max-height: none; margin: 0; border: 0;
  pointer-events: auto; display: grid; place-items: center; padding: 24px; overflow: auto;
  color: #1d2327; background: #fbfaf7; font-size: 15px; line-height: 1.5;
}
.cover > div { max-width: 480px; text-align: center; }
.cover h2 { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
.cover p { margin: 0 0 20px; }
.cover button { background: #4850a5; color: #fff; padding: 8px 16px; }
.cover button:hover { background: #3c4390; }
.cover button:focus-visible { outline-color: #4850a5; }
@media (prefers-color-scheme: dark) {
  .cover { color: #eceeea; background: #22282c; }
  .cover button:focus-visible { outline-color: #a6b2f4; }
}
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

const fmt = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
};

/** Formats a message of the overlay (ICU, with plurals) sent by the background with its placeholders. */
const fill = (labels: Record<string, string>, key: string, params: Record<string, string | number> = {}) =>
  formatMessage(labels[key] ?? '', params, labels.__locale ?? 'en');

export class Overlay {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private layer: HTMLElement | null = null;
  private chip: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private hiddenForVisit = false;
  private seconds = 0;
  private lastAnnounced = -1;
  private seenIntentions = new Set<string>();
  private seenWarnings = new Set<string>();
  private drag: { x: number; y: number } | null = null;
  private position: { left: number; top: number } | null = null;
  private lastUpdate = Date.now();
  private soundOn = false;
  private lastKind: string | null = null;
  private coverEl: HTMLElement | null = null;
  private language: { lang: string; dir: 'ltr' | 'rtl' } = { lang: 'en', dir: 'ltr' };
  onHide: () => void = () => {};

  /** The overlay speaks the extension's language, not the page's (for screen readers and hyphenation). */
  private setLanguage(labels: Record<string, string>) {
    if (labels.__lang) this.language = { lang: labels.__lang, dir: labels.__dir === 'rtl' ? 'rtl' : 'ltr' };
    for (const el of [this.layer, this.live]) {
      if (!el) continue;
      el.lang = this.language.lang;
      el.dir = this.language.dir;
    }
  }

  private ensure() {
    if (this.root) {
      // The page may have removed it (a site that rewrites its body).
      if (!this.host!.isConnected) (document.body ?? document.documentElement).appendChild(this.host!);
      return;
    }
    this.host = document.createElement('webhandbrake-overlay');
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    // Open in the test build only, so that the end-to-end suite can read the overlay.
    this.root = this.host.attachShadow({ mode: __TEST__ ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.layer = document.createElement('div');
    this.layer.className = 'layer';
    this.live = document.createElement('div');
    this.live.className = 'sr';
    this.live.setAttribute('aria-live', 'polite');
    this.root.append(style, this.layer, this.live);
    this.setLanguage({});
    (document.body ?? document.documentElement).appendChild(this.host);
  }

  update(res: TickResponse, labels: Record<string, string>) {
    this.setLanguage(labels);
    this.lastUpdate = Date.now();
    this.soundOn = res.settings.sound;
    if (res.timer && res.settings.showTimer && !this.hiddenForVisit) this.showTimer(res, labels);
    else this.hideTimer();
    const granted = (k: string | null | undefined) => k === 'pause' || k === 'pass';
    if (granted(this.lastKind) && !granted(res.timer?.kind) && this.soundOn) chime();
    this.lastKind = res.timer?.kind ?? null;
    // The intention given at the entry question, recalled discreetly once per pass.
    const intention = res.intention ? `${res.intention.text}|${res.intention.until ?? ''}` : null;
    if (res.intention && intention && !this.seenIntentions.has(intention)) {
      this.seenIntentions.add(intention);
      this.showPanel('#4850a5', fill(labels, 'overlay.intention'), res.intention.text, labels, 15_000);
    }
    if (res.warning && !this.seenWarnings.has(res.warning.id)) {
      this.seenWarnings.add(res.warning.id);
      this.showPanel('#b5762b', res.warning.text, '', labels, 12_000);
    }
  }

  /** Keeps the countdown moving between ticks when the page is not being counted. */
  tickLocal() {
    if (!this.chip) return;
    const elapsed = (Date.now() - this.lastUpdate) / 1000;
    const t = this.chip.querySelector('.time');
    if (t) t.textContent = fmt(this.seconds - elapsed);
  }

  private showTimer(res: TickResponse, labels: Record<string, string>) {
    this.ensure();
    const timer = res.timer!;
    this.seconds = timer.seconds;
    const s = res.settings.timer;
    if (!this.chip) {
      this.chip = document.createElement('div');
      this.chip.className = 'chip';
      this.chip.setAttribute('role', 'timer');
      this.chip.innerHTML =
        '<span class="handle" aria-hidden="true">⠿</span><span class="dot"></span><span class="time"></span><span class="label"></span><button type="button" class="hide"></button>';
      this.chip.querySelector('.hide')!.addEventListener('click', () => {
        this.hiddenForVisit = true;
        this.hideTimer();
        this.onHide();
      });
      this.setupDrag(this.chip, labels);
      this.layer!.appendChild(this.chip);
    }
    const chip = this.chip;
    chip.className = `chip ${s.size}`;
    chip.style.setProperty('--o', String(s.opacity));
    (chip.querySelector('.dot') as HTMLElement).style.background = timer.color;
    chip.querySelector('.time')!.textContent = fmt(timer.seconds);
    const labelKey =
      timer.kind === 'pause'
        ? 'overlay.pauseLeft'
        : timer.kind === 'pass'
          ? 'overlay.passLeft'
          : 'overlay.timerLeft';
    chip.querySelector('.label')!.textContent = fill(labels, labelKey, { group: timer.label });
    const hide = chip.querySelector('.hide') as HTMLButtonElement;
    hide.textContent = '×';
    hide.setAttribute('aria-label', labels['overlay.hide'] ?? 'Hide');
    hide.title = labels['overlay.hide'] ?? 'Hide';
    chip.setAttribute(
      'aria-label',
      fill(labels, 'overlay.timer.aria', { group: timer.label, time: fmt(timer.seconds) }),
    );
    this.place(chip, s.corner);
    // Announce at most once per minute.
    const minute = Math.ceil(timer.seconds / 60);
    if (minute !== this.lastAnnounced && (this.lastAnnounced === -1 || minute < this.lastAnnounced)) {
      this.lastAnnounced = minute;
      if (this.live) this.live.textContent = chip.getAttribute('aria-label') ?? '';
    }
  }

  private place(el: HTMLElement, corner: string) {
    if (this.position) {
      el.style.left = `${this.position.left}px`;
      el.style.top = `${this.position.top}px`;
      el.style.right = el.style.bottom = 'auto';
      return;
    }
    el.style.left = el.style.right = el.style.top = el.style.bottom = 'auto';
    const [v, h] = corner.split('-');
    el.style[v === 'top' ? 'top' : 'bottom'] = '12px';
    el.style[h === 'left' ? 'left' : 'right'] = '12px';
  }

  private setupDrag(el: HTMLElement, labels: Record<string, string>) {
    const handle = el.querySelector('.handle') as HTMLElement;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', labels['overlay.drag'] ?? 'Move');
    handle.removeAttribute('aria-hidden');
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const r = el.getBoundingClientRect();
      this.drag = { x: e.clientX - r.left, y: e.clientY - r.top };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const left = Math.min(window.innerWidth - el.offsetWidth - 4, Math.max(4, e.clientX - this.drag.x));
      const top = Math.min(window.innerHeight - el.offsetHeight - 4, Math.max(4, e.clientY - this.drag.y));
      this.position = { left, top };
      this.place(el, '');
    });
    el.addEventListener('pointerup', () => {
      this.drag = null;
    });
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const r = el.getBoundingClientRect();
      const pos = { left: r.left, top: r.top };
      if (e.key === 'ArrowLeft') pos.left -= step;
      else if (e.key === 'ArrowRight') pos.left += step;
      else if (e.key === 'ArrowUp') pos.top -= step;
      else if (e.key === 'ArrowDown') pos.top += step;
      else return;
      e.preventDefault();
      this.position = {
        left: Math.min(window.innerWidth - el.offsetWidth - 4, Math.max(4, pos.left)),
        top: Math.min(window.innerHeight - el.offsetHeight - 4, Math.max(4, pos.top)),
      };
      this.place(el, '');
    });
  }

  private hideTimer() {
    this.chip?.remove();
    this.chip = null;
  }

  private showPanel(
    color: string,
    title: string,
    body: string,
    labels: Record<string, string>,
    autoHideMs = 0,
  ) {
    this.ensure();
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'status');
    panel.style.setProperty('--c', color);
    const h = document.createElement('h2');
    h.textContent = title;
    panel.appendChild(h);
    if (body) {
      for (const line of body.split('\n')) {
        const p = document.createElement('p');
        p.textContent = line;
        panel.appendChild(p);
      }
    }
    const row = document.createElement('div');
    row.className = 'row';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = labels['overlay.dismiss'] ?? 'OK';
    close.addEventListener('click', () => panel.remove());
    row.appendChild(close);
    panel.appendChild(row);
    this.layer!.appendChild(panel);
    if (autoHideMs) setTimeout(() => panel.remove(), autoHideMs);
  }

  /**
   * Covers a page that refused to be replaced by the block page ("Leave site?" → Stay) until it
   * leaves: nothing of it can be seen or used, and the keys stay in the cover. It cannot be closed;
   * its button (`open`) asks for the block page again. In the top layer where the browser has one,
   * above the page's own dialogs.
   */
  cover(on: boolean, labels: Record<string, string>, open: () => void) {
    if (!on) {
      this.coverEl?.remove();
      this.coverEl = null;
      return;
    }
    this.ensure();
    this.setLanguage(labels);
    if (!this.coverEl) {
      const el = document.createElement('div');
      el.className = 'cover';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'whb-cover-title');
      el.setAttribute('aria-describedby', 'whb-cover-body');
      el.innerHTML =
        '<div><h2 id="whb-cover-title"></h2><p id="whb-cover-body"></p><button type="button"></button></div>';
      el.querySelector('button')!.addEventListener('click', open);
      for (const type of ['keydown', 'keyup', 'keypress']) {
        el.addEventListener(type, (e) => {
          e.stopPropagation();
          if ((e as KeyboardEvent).key === 'Tab') e.preventDefault();
        });
      }
      if ('popover' in el) el.popover = 'manual';
      this.layer!.appendChild(el);
      this.coverEl = el;
    }
    const el = this.coverEl;
    if (el.popover && !el.matches(':popover-open')) {
      try {
        el.showPopover();
      } catch {
        // Not in the document yet: the next update shows it.
      }
    }
    el.querySelector('h2')!.textContent = labels['overlay.cover.title'] ?? '';
    el.querySelector('p')!.textContent = labels['overlay.cover.body'] ?? '';
    const button = el.querySelector('button')!;
    button.textContent = labels['overlay.cover.open'] ?? '';
    // Out of the page: what it had focused no longer gets the keys.
    if (document.activeElement !== this.host) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      button.focus();
    }
  }

  /** A countdown that cannot be postponed, with a button to copy the draft. */
  grace(seconds: number, labels: Record<string, string>, draft: () => string, done: () => void) {
    this.ensure();
    this.setLanguage(labels);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-live', 'assertive');
    const h = document.createElement('h2');
    h.textContent = labels['overlay.grace.title'] ?? '';
    const p = document.createElement('p');
    const row = document.createElement('div');
    row.className = 'row';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fillEl = document.createElement('i');
    fillEl.style.width = '100%';
    bar.appendChild(fillEl);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'primary';
    copy.textContent = labels['overlay.grace.copy'] ?? 'Copy draft';
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(draft()).then(() => {
        copy.textContent = labels['overlay.grace.copied'] ?? 'Copied';
      });
    });
    row.append(bar, copy);
    panel.append(h, p, row);
    this.layer!.appendChild(panel);
    const end = Date.now() + seconds * 1000;
    const update = () => {
      const left = Math.max(0, (end - Date.now()) / 1000);
      p.textContent = fill(labels, 'overlay.grace.body', { seconds: Math.ceil(left) });
      fillEl.style.width = `${(left / seconds) * 100}%`;
      if (left <= 0) {
        clearInterval(iv);
        panel.remove();
        done();
      }
    };
    const iv = setInterval(update, 1000);
    update();
    copy.focus();
  }
}

function chime() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ac.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.8);
  } catch {
    // autoplay policy or no audio
  }
}
