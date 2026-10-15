# WebHandbrake

**A handbrake for the web.** WebHandbrake is a browser extension that helps you use the sites you
choose when and as much as you decided. Before a site is blocked it can add gentler friction: a
filter, a question, a short wait or a typed challenge. Loosening your own rules takes time, so a
moment of impulse cannot undo them. Everything stays on your device: no account, no server, no
analytics.

## What it does

- **Rules for the sites you choose**: whole domains, single hosts, paths, exact pages, wildcards,
  regular expressions and exceptions. Paste addresses, lists, hosts files or uBlock Origin, AdGuard
  and uBlacklist filters, or start from a ready-made list.
- **Conditions that read like sentences**: "Mon–Fri 09:00–17:00 → Block", "Always, after 45 min a
  day → Wait 30 s". Time windows (overnight too), time and visit limits per hour, day, week or
  month, and limits on continuous use.
- **Graduated interventions**: count only, visual filter, a question about what you want to do, a
  wait, a typed challenge, block, close or redirect. Pages can be saved for later.
- **Blocking before the page loads**, from the moment the browser starts, including single-page
  applications and pages restored from the back/forward cache.
- **Breaks and focus sessions** that end by themselves.
- **A protection per rule**: a stricter rule applies at once; loosening one takes what you chose
  for it: a confirmation, a wait of the length you choose, a password, a partner's code from their
  phone, nothing until a date, or nothing at all. An emergency exit always exists.
- **"Why?"** on every intervention: which rule and condition apply, and when that changes.
- **Statistics on your device**, with export and deletion in one click.
- **Export, import and automatic backups.**
- **Accessible and translatable**: keyboard and screen-reader support, light, dark and
  high-contrast themes, layouts down to phone size.

**Help**, in the dashboard, explains every feature and works offline.

## Supported browsers

| Browser | Minimum version |
| --- | --- |
| Chrome and other Chromium browsers | 121 |
| Firefox | 140 |
| Firefox for Android | 142 |

Keyboard shortcuts and the context menu are not available on Firefox for Android.

## Install

WebHandbrake is not published in the browser stores. To try it, build it from source with Node.js
(the version in `.nvmrc` is 24.14.0):

```bash
npm ci
npm run build          # writes dist/chrome and dist/firefox
```

- **Chrome**: open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and
  select `dist/chrome`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and
  select `dist/firefox/manifest.json`. Firefox removes temporary add-ons when it closes.
- **Firefox for Android**: `npx web-ext run -t firefox-android --source-dir dist/firefox
  --android-device <id>`.

## Privacy

WebHandbrake makes no network requests of its own and keeps all its data in your browser profile.
[PRIVACY.md](PRIVACY.md) lists what it stores, why it needs each permission and how to delete
everything.

## Accessibility

WebHandbrake aims at level AA of the Web Content Accessibility Guidelines (WCAG) 2.2: keyboard use
with a visible focus, screen readers, browser zoom, light, dark and high-contrast themes, and
layouts down to phone width. It has not been evaluated for conformance. Automated checks (axe-core)
run on every change over the dashboard, the popup and the intervention pages, and keyboard
scenarios are tested; there has been no manual evaluation and no test with a screen reader, and
Firefox for Android has not been evaluated.

Known limitations:

- The panels inside web pages (timer, warnings, grace period) follow the system's light or dark
  appearance, not the theme or **High contrast** chosen in **Settings › General**.
- Animations are reduced only through the system's reduced-motion setting.
- A wait, challenge or confirmation that you have started expires
  60 minutes after its wait ends, and a
  pending change must be confirmed within
  48 hours after its wait is
  over.
- Completing the emergency exit needs a sentence to be typed.
- A challenge drawn as an image offers **I use a screen reader: type a sentence instead**. Every
  intervention and break cost can be one that needs no typing or waiting, and the **Reminder**
  protection asks only for a confirmation.

Report a barrier with the **Accessibility problem** form on the
[issue page](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose).

## Help and feedback

- Questions and ideas:
  [GitHub Discussions](https://github.com/fabiomolignoni/WebHandbrake/discussions).
- Something does not work: the
  [bug report form](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose).
- Security problems: the
  [private reporting form](https://github.com/fabiomolignoni/WebHandbrake/security/advisories/new);
  please do not open a public issue.
- Accessibility: [what is supported and the known gaps](#accessibility).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[GNU General Public License v3.0 or later](LICENSE).
