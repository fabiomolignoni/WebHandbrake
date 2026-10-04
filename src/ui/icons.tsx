/** Small inline SVG icon set (no external fonts or images, PRIV-06). 24×24 stroke icons. */

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v6 M14 11v6',
  edit: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18 M6 6l12 12',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 4l13 8-13 8z',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.8-1',
  alert: 'M12 3l10 18H2z M12 10v4 M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7h.01',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  upload: 'M12 20V8 M7 13l5-5 5 5 M4 4h16',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off':
    'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 3.1a4 4 0 0 1 0 7.8 M22 21v-1a6 6 0 0 0-4-5.6',
  newspaper: 'M4 4h13v16H6a2 2 0 0 1-2-2z M17 8h3v10a2 2 0 0 1-2 2 M8 8h5 M8 12h5 M8 16h5',
  cart: 'M3 4h2l2.4 11h10.2L20 8H6.2 M9 20h.01 M17 20h.01',
  gamepad:
    'M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6h-6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z M7 11v3 M5.5 12.5h3 M15 12h.01 M18 11h.01',
  dice: 'M4 4h16v16H4z M8.5 8.5h.01 M15.5 8.5h.01 M12 12h.01 M8.5 15.5h.01 M15.5 15.5h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
  timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 10v4 M10 2h4 M19 7l1.5-1.5',
  hourglass: 'M6 2h12 M6 22h12 M7 2v4l5 6-5 6v4 M17 2v4l-5 6 5 6v4',
  leaf: 'M11 20A7 7 0 0 1 4 13c0-6 7-10 16-10 0 9-4 16-10 16z M4 21c3-5 6-8 11-11',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  flask: 'M9 3h6 M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3 M7 15h10',
  'arrow-left': 'M19 12H5 M12 19l-7-7 7-7',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17 M3 21h18 M14 12h.01',
  wind: 'M3 8h11a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h8',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M5.6 5.6l12.8 12.8',
  heart:
    'M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7z M16 7h.01',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9z',
};

export function Icon({ name, label, class: cls }: { name: string; label?: string; class?: string }) {
  const d = PATHS[name] ?? PATHS.circle;
  return (
    <svg
      class={`icon-svg${cls ? ` ${cls}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export const GROUP_ICONS = [
  'circle',
  'users',
  'play',
  'newspaper',
  'cart',
  'gamepad',
  'dice',
  'chat',
  'eye-off',
  'globe',
  'heart',
  'zap',
];

export function BrakeLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="120" height="120" rx="28" style={{ fill: 'var(--accent, #2f7a78)' }} />
      <path
        d="M33 31 A47 47 0 0 0 33 97"
        fill="none"
        stroke="#ffffffb0"
        stroke-width="8"
        stroke-linecap="round"
      />
      <path
        d="M95 31 A47 47 0 0 1 95 97"
        fill="none"
        stroke="#ffffffb0"
        stroke-width="8"
        stroke-linecap="round"
      />
      <circle cx="64" cy="64" r="27" fill="none" stroke="#fff" stroke-width="8" />
      <path
        d="M57 77 V51 H67 a8 8 0 0 1 0 16 H57"
        fill="none"
        stroke="#fff"
        stroke-width="7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
