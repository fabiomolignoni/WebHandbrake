# Chrome Web Store — WebHandbrake 1.0.0

Testi da incollare nella [Developer Dashboard](https://chrome.google.com/webstore/devconsole), nell'ordine
delle schede. I testi tra i blocchi di codice sono quelli da copiare; il resto sono note.

## Come è costruita la scheda

- **Una storia in cinque immagini**, la stessa nei due store e nella descrizione: blocca, rallenta,
  regole, protezione, privacy. Il messaggio principale sta nelle prime due, perché molti
  visitatori non scorrono oltre.
- **Un messaggio per immagine**: un titolo di beneficio in poche parole, una riga che lo spiega e
  l'interfaccia vera, ingrandita su ciò che il titolo promette.
- **Stesso sfondo, carattere e cornice** in tutte le immagini, coerenti con l'icona e le tile.
- **Descrizione**: un paragrafo d'apertura e poi brevi elenchi, nell'ordine delle immagini. Dice
  anche cosa l'estensione non fa (non invia dati) e perché chiede l'accesso a tutti i siti: sono
  i dubbi che più spesso fermano un'installazione.

## Prima di iniziare

- Account sviluppatore: quota di registrazione una tantum, email di contatto verificata e
  dichiarazione "trader / non-trader" (richiesta per l'UE). Per un progetto personale, gratuito e
  open source, di norma si dichiara **non-trader**.
- Pacchetto: `npm run release -- 1.0.0 --push` chiude la versione e fa partire il workflow di
  release, che allega `webhandbrake-chrome-1.0.0.zip` alla bozza della release di GitHub, con
  checksum e attestazione. In locale, `npm run package` lo scrive in `web-ext-artifacts/`.

## Scheda "Package"

Carica `webhandbrake-chrome-1.0.0.zip`. Nome e sintesi vengono dal manifest
(`src/_locales/en/messages.json`, chiavi `extName` ed `extDescription`) e la dashboard non
permette di cambiarli.

| Campo | Valore |
| --- | --- |
| Name (max 75) | `WebHandbrake – Website Blocker & Time Limits` (44) |
| Summary (max 132) | `Block distracting websites or slow them down: schedules, daily limits, focus sessions. Privacy-focused and open source.` (119) |

Nello store si cerca per funzione ("website blocker", "block sites") e il nome è il campo che pesa
di più nella ricerca; la sintesi compare nei risultati di ricerca e dice subito cosa fa
l'estensione. Il nome compare anche in `chrome://extensions` e in `about:addons`; il titolo del
pulsante nella barra resta "WebHandbrake".

## Scheda "Store listing"

### Description

Il Chrome Web Store mostra testo semplice: niente Markdown, gli a capo restano. Nessun nome di
altri prodotti o siti, per non incappare nella regola sul keyword spam.

```text
WebHandbrake blocks the websites that pull you in, or slows them down so that you go in only when you mean to. Choose the sites, when each rule applies and what happens. Making a rule stricter is instant; loosening it takes what you chose for it, so a moment of impulse cannot undo it. No account, no tracking: everything stays on your device.

BLOCK THE SITES THAT PULL YOU IN
• Block during work hours, after a daily time limit, or for a focus session.
• Most pages are stopped before they even load, from the moment the browser starts.
• Need a site for a minute? Take a break, with the length, number and cost you set.

SLOW DOWN INSTEAD OF BLOCKING
• Ask first: say what you want to do, and for how long, before the site opens.
• Wait: a short countdown that lets the impulse pass.
• Challenge: type a random text to continue.
• Or a visual filter such as grayscale, a redirect to a page you choose, or closing the tab.

RULES THAT FIT YOUR DAY
• Time windows (overnight too), daily, weekly or monthly time limits, visit limits and limits on continuous use.
• Start from a ready-made list (social media, video, news, shopping, games, forums) or paste your own: domains, single pages, wildcards and exceptions.
• The toolbar popup shows the time left on the current site and starts a focus session in one click.
• "Why?" tells you which rule applies and when that changes.

EASY TO TIGHTEN, HARD TO UNDO
• Each rule has its protection: a reminder, a wait of the length you choose, a password, a code from a trusted person's authenticator app, a lock until a date, or permanent.
• An emergency exit always works and needs nobody else: you wait (24 hours by default), then type a sentence.

YOUR NUMBERS STAY ON YOUR DEVICE
• Insights shows your time and visits by day, rule and site. Export them or delete them at any time.
• No account, no server, no analytics, no ads. WebHandbrake makes no network requests of its own.
• Free and open-source software.

ALSO
• Save a page for later and find it when the site is allowed again.
• Light, dark and high-contrast themes, keyboard and screen-reader support.
• Export, import and automatic backups. Help inside the extension, available offline.

WHY IT ASKS TO "READ AND CHANGE ALL YOUR DATA ON ALL WEBSITES"
WebHandbrake checks the address of each page you open against your rules, and stops a restricted page before it loads. Nothing it reads is ever sent anywhere. The privacy policy explains each permission: https://github.com/fabiomolignoni/WebHandbrake/blob/main/PRIVACY.md

Source code, questions and bug reports: https://github.com/fabiomolignoni/WebHandbrake
```

### Category

`Workflow & Planning`

Alternativa: `Well-being`. Lo store ne accetta una sola; "Workflow & Planning" è dove si cercano
i blocchi di siti per la produttività.

### Language

`English`

### Graphic assets

File in `store/images/`: PNG a 24 bit senza trasparenza, tranne l'icona, che deve averla.

| Campo | File |
| --- | --- |
| Store icon | `chrome-web-store/store-icon-128.png` (128×128: disegno 96×96 con 16 px trasparenti per lato, come chiede Google) |
| Screenshot 1 | `screenshots/1-block.png` |
| Screenshot 2 | `screenshots/2-slow-down.png` |
| Screenshot 3 | `screenshots/3-rules.png` |
| Screenshot 4 | `screenshots/4-protection.png` |
| Screenshot 5 | `screenshots/5-insights.png` |
| Small promo tile (obbligatoria) | `chrome-web-store/promo-small-440x280.png` |
| Marquee promo tile (facoltativa) | `chrome-web-store/promo-marquee-1400x560.png` |
| Global promo video | facoltativo, non c'è |

Gli screenshot sono 1280×800, nell'ordine indicato. `6-android.png` è solo per Firefox: Chrome
per Android non supporta le estensioni.

### Additional fields

| Campo | Valore |
| --- | --- |
| Official URL | `None` (richiede un dominio verificato in Search Console) |
| Homepage URL | `https://github.com/fabiomolignoni/WebHandbrake` |
| Support URL | `https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose` |
| Mature content | No |

La Support URL apre la pagina che offre segnalazione di bug, problema di accessibilità, domande
(Discussions), idee e segnalazione privata di vulnerabilità.

## Scheda "Privacy practices"

### Single purpose description

```text
WebHandbrake helps people limit their own use of the websites they choose. The user creates rules (which sites, when, and what happens), and WebHandbrake applies them while the user browses: it counts the time spent on those sites and, when a rule applies, adds friction before the page opens (a visual filter, a question, a wait or a typed challenge), or blocks, closes or redirects it. Focus sessions, breaks, statistics and the protection of rules against impulsive loosening all serve this single purpose. Everything runs and is stored locally on the user's device.
```

### Permission justification

Un campo per ogni permesso del manifest.

**storage**

```text
Stores the user's rules, settings and statistics, and short-lived state such as breaks, focus sessions and pending changes, in chrome.storage.local and chrome.storage.session, on the device only. chrome.storage.sync is never used.
```

**unlimitedStorage**

```text
Daily statistics are kept for the period the user chooses (730 days by default), together with automatic backups of the rules: one before each of the last 20 changes and one a day for 30 days. Without this permission the default quota could be exceeded and backups or statistics would be lost. All data stays on the device.
```

**declarativeNetRequest**

```text
Core function. WebHandbrake installs dynamic and session rules, generated only from the user's own configuration, that stop the pages the user restricted before they load: they redirect them to the extension's intervention page (a question, a wait, a typed challenge or a block page), block them, or redirect them to an address the user chose.
```

**tabs**

```text
Reads the URL of open tabs so that a rule which starts applying (at a scheduled time, when a daily limit runs out, or when a focus session starts) also applies to tabs that are already open; closes a tab when the user's rule says "Close tab" or the user chooses "Close the tab"; shows the status of the current site in the popup; and, only if the user turns it on, protects the browser's extension and settings pages, which host permissions do not cover. It never reads the content of tabs.
```

**webNavigation**

```text
Detects page changes that network rules cannot see: in-page navigations of single-page applications (history.pushState), changes of the URL fragment, pages restored from the back/forward cache, and blocked requests when site access is missing. Without it, a restricted page could be reached by navigating inside a page that is already open. No navigation history is kept.
```

**webRequest**

```text
Non-blocking, read-only observation of the Date response header of the top-level pages the browser loads anyway, to detect a manipulated system clock that would otherwise let the user get around time-based rules. No request is blocked, changed, stored or sent, and no extra request is made. The user can turn this off in Settings › Time.
```

**alarms**

```text
Wakes the service worker when a schedule, a limit, a break or a focus session changes state, and once a minute for maintenance, so that rules start and end on time.
```

**idle**

```text
Stops counting time on the user's limited sites while the user is inactive or the screen is locked, so that time limits measure actual use.
```

**scripting**

```text
Injects the extension's own packaged content script into the sites covered by the user's rules, to show the on-page timer, the visual filters and the grace period while the user is typing, and to count active time. No remote code is ever injected.
```

**contextMenus**

```text
Adds the right-click menu items "Block this site in…" (to add the current site to a rule) and "Start a focus session".
```

**notifications** (permesso facoltativo)

```text
Optional permission, requested only when the user turns on notifications in Settings › Feedback. Shows system notifications when a focus session ends, when a pending change can be confirmed, and before a restriction starts.
```

**Host permission justification** (`<all_urls>`)

```text
The user decides which sites to restrict and can add any site at any time, including wildcards (such as amazon.*) and regular expressions, and a focus session can block every site except a short list. WebHandbrake therefore checks the address of every page against the user's rules, redirects a restricted page to its intervention page before it loads, injects its packaged content script (timer, filters, active-time counting) into the restricted sites, and reads the Date header for the clock check. All of this happens on the device; nothing is sent anywhere.
```

### Remote code

`No, I am not using remote code.`

Tutto il JavaScript è nel pacchetto; la CSP delle pagine è `script-src 'self'`.

### Data usage

Google chiede di dichiarare anche i dati trattati solo sul dispositivo
([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
domanda 3), quindi consiglio di spuntare le tre categorie che WebHandbrake legge davvero, anche
se non escono mai dal browser:

| Categoria | Spunta | Perché |
| --- | --- | --- |
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | La password di una regola è un lucchetto dell'estensione, salvato solo come hash; non è una credenziale di un account. Se il revisore la considera tale, aggiungila. |
| Personal communications | No | |
| Location | No | |
| **Web history** | **Sì** | Nomi dei siti con tempo e visite per giorno, pagine salvate per dopo (indirizzo e titolo), registro delle decisioni recenti. |
| **User activity** | **Sì** | Quando l'utente ha usato tastiera, mouse o touch (non cosa ha digitato), per contare il tempo attivo. |
| **Website content** | **Sì** | Il testo del campo in cui si sta scrivendo, letto solo nella pagina per il periodo di grazia ("Copy my draft"); mai salvato né inviato. |

Spunta tutte e tre le certificazioni:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```text
https://github.com/fabiomolignoni/WebHandbrake/blob/main/PRIVACY.md
```

## Scheda "Distribution"

- **Payments**: Free
- **Visibility**: Public (o Unlisted per una prima prova con pochi utenti)
- **Regions**: All regions

## Scheda "Test instructions" (facoltativa)

Non serve un account, ma qualche riga aiuta il revisore a vedere l'estensione all'opera:

```text
No account, login or payment is needed.
1. After installation the welcome page opens. Choose "Set up in about a minute".
2. Sites: pick the ready-made "Social media" list. When: "Every time". What happens: "Wait" (30 s). Protection: "Reminder". Review: "Create rule".
3. Open https://www.facebook.com in a new tab: the wait page replaces it before it loads, and "Why?" explains which rule applies.
4. The toolbar popup shows the state of the current site; its "Dashboard" button opens Rules, Today, Focus, Insights, Protection, Settings and Help.
```
