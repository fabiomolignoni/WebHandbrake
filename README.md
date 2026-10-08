# WebHandbrake

**A handbrake for the web.** WebHandbrake is a browser extension that helps you use the sites you
choose when and as much as you decided. Before a site is blocked it can add gentler friction: a
reminder, a question, a short wait or a typed challenge. Loosening your own rules takes time, so a
moment of impulse cannot undo them. Everything stays on your device: no account, no server, no
analytics.

## What it does

- **Rules for the sites you choose**: whole domains, single hosts, paths, exact pages, wildcards,
  regular expressions and exceptions. Paste addresses, lists, hosts files or uBlock Origin, AdGuard
  and uBlacklist filters, or start from a ready-made list.
- **Conditions that read like sentences**: "Mon–Fri 09:00–17:00 → Block", "Always, after 45 min a
  day → Wait 30 s". Time windows (overnight too), time and visit limits per hour, day, week or
  month, and limits on continuous use.
- **Graduated interventions**: count only, reminder, visual filter, a question about your
  intention, a wait, a typed challenge, block, close or redirect. Pages can be saved for later.
- **Blocking before the page loads**, from the moment the browser starts, including single-page
  applications and pages restored from the back/forward cache.
- **Breaks and focus sessions** that end by themselves.
- **Protection levels**: a stricter rule applies at once; loosening one costs a confirmation, a
  wait, or a cooling-off period and a typed confirmation, depending on the level you chose. An
  emergency exit always exists.
- **"Why?"** on every intervention: which rule and condition apply, and when that changes.
- **Statistics on your device**, with export and deletion in one click.
- **Export, import and automatic backups.**
- **Accessible and translatable**: keyboard and screen-reader support, light, dark and
  high-contrast themes, layouts down to phone size.

The [user guide](docs/user-guide.md) explains every feature; it is the same text as **Help** in
the extension.

## Supported browsers

| Browser | Minimum version |
| --- | --- |
| Chrome and other Chromium browsers | <!-- fact: manifest.chrome.min -->121<!-- /fact --> |
| Firefox | <!-- fact: manifest.firefox.min -->140<!-- /fact --> |
| Firefox for Android | <!-- fact: manifest.android.min -->142<!-- /fact --> |

Keyboard shortcuts and the context menu are not available on Firefox for Android.

## Install

WebHandbrake is not published in the browser stores. To try it, build it from source with Node.js
(the version in `.nvmrc` is <!-- fact: toolchain.node -->24.14.0<!-- /fact -->):

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

## Help and feedback

- Questions and ideas: [SUPPORT.md](SUPPORT.md).
- Security problems: [SECURITY.md](SECURITY.md); please do not open a public issue.
- Accessibility: [docs/accessibility.md](docs/accessibility.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). The
[documentation index](docs/README.md) lists the design, requirement and architecture documents.

## Licence

[GNU General Public License v3.0 or later](LICENSE).
