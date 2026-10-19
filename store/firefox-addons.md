# Firefox Add-ons (AMO) — WebHandbrake 1.0.0

Testi da incollare nel [Developer Hub](https://addons.mozilla.org/developers/) per la prima
pubblicazione ("Submit a New Add-on", poi "Edit Product Page"). I testi tra i blocchi di codice
sono quelli da copiare; il resto sono note.

Immagini, struttura della descrizione e messaggi sono gli stessi del Chrome Web Store (vedi
"Come è costruita la scheda" in [chrome-web-store.md](chrome-web-store.md)), più un'immagine per
Firefox per Android.

## 1. Upload

- **Where to host**: On this site.
- **File**: `webhandbrake-firefox-1.0.0.zip` dalla bozza della release di GitHub, creata da
  `npm run release -- 1.0.0 --push` (in locale: `npm run package`, in `web-ext-artifacts/`).
- **Compatibility**: spunta **Firefox** e **Firefox for Android** (il manifest dichiara
  `gecko_android`, minimo 142; Firefox desktop minimo 140).
- L'ID `webhandbrake@webhandbrake.org` del manifest diventa definitivo con il primo upload. Non
  serve possedere il dominio, ma non si potrà più cambiare.
- Il manifest dichiara `data_collection_permissions: none`: AMO mostrerà che l'estensione non
  raccoglie dati.

## 2. Source code

AMO chiede i sorgenti quando il codice è generato da un bundler, anche senza minificazione, come
qui (esbuild).

- **Do you need to submit source code?** Yes.
- **File**: `webhandbrake-source-1.0.0.zip` dalla stessa bozza di release (`git archive` del
  commit taggato; in locale: `npm run package:source`).

Ho verificato in questa sessione che, estratto l'archivio dei sorgenti di `HEAD`, `npm ci` e
`npm run build:firefox` producono una `dist/firefox` identica file per file a quella del
repository, e che `web-ext lint` dà 0 errori e 3 avvisi, tutti nel codice di Preact (spiegati
nelle note al revisore).

### Notes to Reviewer

```text
WebHandbrake limits the user's own use of the websites they choose (a site blocker with gentler steps: a filter, a question, a wait, a typed challenge). It has no account and no server, and makes no network requests of its own.

BUILD
The package is bundled with esbuild (not minified, no source maps). The attached source archive is a git archive of the released commit.
Environment: Ubuntu 24.04 (any Linux or macOS works), Node.js 24.14.0 as in .nvmrc (the "engines" field of package.json lists the other versions that work), the npm bundled with Node.
  npm ci
  npm run build:firefox
The output is dist/firefox/, identical file by file to the uploaded package (the build writes no timestamps). To compare:
  unzip webhandbrake-firefox-1.0.0.zip -d package && diff -r package dist/firefox
Build script: scripts/build.mjs. Manifest: scripts/manifest.mjs. The only bundled third-party library is Preact (MIT); its licence is in THIRD_PARTY_NOTICES.txt.

LINT
web-ext lint reports 0 errors and 3 UNSAFE_VAR_ASSIGNMENT warnings (dashboard.js, popup.js, intervention.js, line 217). They are in Preact's own code, which supports dangerouslySetInnerHTML; WebHandbrake never uses dangerouslySetInnerHTML.

PERMISSIONS
- <all_urls>, webNavigation, tabs, scripting: check the address of each page against the user's rules (which can use wildcards and regular expressions, and a focus session can block everything except a short list), redirect a restricted page to the extension's intervention page before it loads, and inject the packaged content script (on-page timer, visual filters, active-time counting).
- declarativeNetRequest: the blocking and redirect rules, generated from the user's configuration.
- webRequest: non-blocking and read-only; the Date header of top-level responses, to detect a manipulated system clock. It can be turned off in Settings > Time.
- idle, alarms, storage, unlimitedStorage, contextMenus; notifications is optional.
Everything is explained in PRIVACY.md.

HOW TO TEST
1. After installation the welcome page opens. Choose "Set up in about a minute".
2. Sites: pick the ready-made "Social media" list. When: "Every time". What happens: "Wait" (30 s). Protection: "Reminder". Review: if it asks for access to websites, choose "Allow access"; then "Create rule".
3. Open https://www.facebook.com in a new tab: the wait page replaces it before it loads, and "Why?" explains which rule applies.
4. The toolbar popup shows the state of the current site; its "Dashboard" button opens Rules, Today, Focus, Insights, Protection, Settings and Help.
```

## 3. Describe add-on

### Name

Lo stesso del manifest (AMO lo riprende da lì):

```text
WebHandbrake – Website Blocker & Time Limits
```

### Add-on URL

```text
webhandbrake
```

(→ `https://addons.mozilla.org/firefox/addon/webhandbrake/`)

### Summary

Al massimo 250 caratteri; questo ne ha 223. La sintesi del manifest è quella di Chrome (al
massimo 132 caratteri); qui c'è spazio per dire anche come rallenta e che le regole non si
allentano d'impulso.

```text
Block distracting websites, or slow them down with a question, a short wait or a typed challenge. Set schedules, daily limits and focus sessions, and make your rules hard to undo on impulse. Privacy-focused and open source.
```

### Description

AMO interpreta un sottoinsieme di Markdown (grassetto, corsivo, link, elenchi; niente titoli né
HTML).

```markdown
WebHandbrake blocks the websites that pull you in, or slows them down so that you go in only when you mean to. Choose the sites, when each rule applies and what happens. Making a rule stricter is instant; loosening it takes what you chose for it, so a moment of impulse cannot undo it. No account, no tracking: everything stays on your device.

**Block the sites that pull you in**

- Block during work hours, after a daily time limit, or for a focus session.
- Most pages are stopped before they even load, from the moment the browser starts.
- Need a site for a minute? Take a break, with the length, number and cost you set.

**Slow down instead of blocking**

- **Ask first**: say what you want to do, and for how long, before the site opens.
- **Wait**: a short countdown that lets the impulse pass.
- **Challenge**: type a random text to continue.
- Or a visual filter such as grayscale, a redirect to a page you choose, or closing the tab.

**Rules that fit your day**

- Time windows (overnight too), daily, weekly or monthly time limits, visit limits and limits on continuous use.
- Start from a ready-made list (social media, video, news, shopping, games, forums) or paste your own: domains, single pages, wildcards and exceptions.
- The toolbar popup shows the time left on the current site and starts a focus session in one click.
- **Why?** tells you which rule applies and when that changes.

**Easy to tighten, hard to undo**

- Each rule has its protection: a reminder, a wait of the length you choose, a password, a code from a trusted person's authenticator app, a lock until a date, or permanent.
- An emergency exit always works and needs nobody else: you wait (24 hours by default), then type a sentence.

**Your numbers stay on your device**

- **Insights** shows your time and visits by day, rule and site. Export them or delete them at any time.
- No account, no server, no analytics, no ads. WebHandbrake makes no network requests of its own.
- Free and open-source software: [source code on GitHub](https://github.com/fabiomolignoni/WebHandbrake).

**Also**

- Works on Firefox for Android, with a layout made for your phone.
- Save a page for later and find it when the site is allowed again.
- Light, dark and high-contrast themes, keyboard and screen-reader support.
- Export, import and automatic backups. Help inside the extension, available offline.

**Why it asks to "access your data for all websites"**: WebHandbrake checks the address of each page you open against your rules, and stops a restricted page before it loads. Nothing it reads is ever sent anywhere. The [privacy policy](https://github.com/fabiomolignoni/WebHandbrake/blob/main/PRIVACY.md) explains each permission.
```

### Experimental / payment

- **This add-on is experimental**: No
- **This add-on requires payment, non-free services or software, or additional hardware**: No

### Categories

Al massimo due:

- `Privacy & Security`
- `Other`

AMO non ha una categoria "produttività"; è la coppia usata dalle estensioni dello stesso tipo.

### Support

| Campo | Valore |
| --- | --- |
| Support email | facoltativa: lascia vuoto, oppure un indirizzo dedicato (sarà pubblico) |
| Support website | `https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose` |

### License

`GNU General Public License v3.0` (il progetto è GPL-3.0-or-later: se l'elenco offre la variante
"or later", scegli quella).

### Privacy policy

Spunta **This add-on has a privacy policy** e incolla questa versione breve (il campo accetta lo
stesso Markdown della descrizione, ma non le tabelle di `PRIVACY.md`):

```markdown
**WebHandbrake has no account, no server, no telemetry and no analytics, and makes no network requests of its own.** Everything it stores stays in your browser profile on this device (extension storage, never sync storage). Nothing is sold, shared or transmitted, to anyone.

**What it reads, on this device only**

- The address of every page you open, to check it against your rules.
- The Date header of the top-level pages the browser loads anyway, to notice a manipulated system clock. It makes no extra requests, and this can be turned off in Settings › Time.
- On the sites of your rules: whether the page is visible and focused, when you last used the keyboard, mouse or touch screen (never what you typed), and whether audio or video is playing, to count active time and show the timer, filters and grace period.
- The text of the field you are typing in, inside the page only, for the grace period's "Copy my draft" button. It is never stored or passed to the rest of WebHandbrake.
- Whether the device is idle or locked, to stop counting time.

**What it stores**

- Your rules and settings, and automatic backups of them. Rule passwords are kept only as salted hashes.
- Daily statistics per rule and per site name (never full addresses), kept 730 days by default.
- Breaks and their reasons, focus sessions, pending changes, protection events, the pages you save for later, and the reasons you type when WebHandbrake asks what you want to do.
- Until the browser closes: a log of the last 200 restricted pages, which you can turn off in Settings › Diagnostics.

**Private windows**: WebHandbrake runs there only if you allow it, and keeps there only the totals your limits need, not per-site statistics.

**Your choices**: export your data, delete statistics (Insights › Data or Settings › Privacy), turn off the decision log and the clock check. Uninstalling WebHandbrake removes everything it stored.

The full policy lists every item stored and every permission: https://github.com/fabiomolignoni/WebHandbrake/blob/main/PRIVACY.md
```

## 4. Dopo l'invio: "Edit Product Page"

### Images

Icona: AMO usa quella del manifest; non serve caricarne un'altra.

Screenshot in `store/images/screenshots/` (1280×800, il formato consigliato da AMO), nell'ordine
indicato. AMO mostra la didascalia sotto l'immagine e la usa come testo alternativo, quindi
ripete il titolo dell'immagine e lo completa:

| File | Caption |
| --- | --- |
| `1-block.png` | `Block the sites that pull you in: during work hours, after a daily limit, or whenever you need to focus.` |
| `2-slow-down.png` | `Slow down instead of blocking: a question, a short breath or a typed challenge before the site opens.` |
| `3-rules.png` | `Rules that fit your day: hours and daily limits for any list of sites, and a focus session in one click.` |
| `4-protection.png` | `Easy to tighten, hard to undo: loosening a rule takes the wait, password, friend's code or date you chose.` |
| `5-insights.png` | `Your numbers stay on your device: no account, no server, no analytics.` |
| `6-android.png` | `Also on Firefox for Android: your rules, breaks and focus sessions on your phone.` |

### Additional details

| Campo | Valore |
| --- | --- |
| Tags | `content blocker`, `social media`, `privacy` (AMO ammette solo tag di un elenco predefinito) |
| Homepage | `https://github.com/fabiomolignoni/WebHandbrake` |
| Contributions URL | vuoto |

### Technical details › Developer comments

```markdown
WebHandbrake works inside this browser profile: it makes getting around your rules slower and more deliberate, not impossible. It does not cover other browsers or devices, new profiles or troubleshoot mode, and it runs in private windows only if you allow it (Add-ons and themes › WebHandbrake › Run in Private Windows). **Protection › How solid is your protection?** shows which of these ways are open in your browser.

On Firefox for Android, keyboard shortcuts and the right-click menu are not available, and the browser's own pages cannot be protected.

Questions: [GitHub Discussions](https://github.com/fabiomolignoni/WebHandbrake/discussions). Something does not work: [report a problem](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose). A diagnostic report (Settings › Diagnostics) helps, and leaves out addresses unless you include them.
```

### Release notes della versione 1.0.0

Campo "Release notes" della versione (Manage Status & Versions › 1.0.0):

```markdown
The first version of WebHandbrake.

- Rules for the sites you choose, with time windows, time and visit limits, and limits on continuous use.
- From the gentlest to the strongest: count only, filter, ask first, wait, challenge, block, close the tab or redirect.
- Breaks from a block, focus sessions, and pages saved for later.
- One protection per rule against loosening it on impulse, and an emergency exit that always works.
- Insights stored on your device, export, import and automatic backups.
- Firefox, Firefox for Android and Chrome.
```
