# Store listings

Last reviewed: 2026-10-08

The texts and answers that the Chrome Web Store and Firefox Add-ons ask for when WebHandbrake is
submitted. Copy them from here at each release, and change them here first, so that every change
is reviewed with the code it describes. The [release checklist](releasing.md#release-checklist)
says when.

## Shared texts

- **Name**: WebHandbrake
- **Short description** (the manifest's description, at most 132 characters in Chrome):
  <!-- fact: manifest.description -->A handbrake for the web: slow down, limit or block the sites you choose, on your own schedules. Nothing leaves your device.<!-- /fact -->
- **Single purpose**: Lets you limit, slow down or block the websites you choose, on your own
  schedules and time limits. Statistics, breaks, focus sessions and protection levels serve this
  purpose.
- **Homepage**: <https://github.com/fabiomolignoni/WebHandbrake>
- **Support**: <https://github.com/fabiomolignoni/WebHandbrake/blob/main/SUPPORT.md>
- **Privacy policy**: <https://github.com/fabiomolignoni/WebHandbrake/blob/main/PRIVACY.md>. This
  address must never change.

### Description

```text
WebHandbrake slows down, limits or blocks the websites you choose, when you choose.

• Rules: pick the sites, when the rule applies (always, at certain times, after some time or a
  number of visits) and what happens: a reminder, a filter such as grayscale, a question about
  what you want to do, a short wait, a typed challenge, a block, closing the tab or a redirect.
• Precise addresses: a whole site, one section, a single page or only the home page, with
  exceptions for the parts you need.
• Breaks and focus sessions: pause a rule for a few minutes, or block distractions for a while.
• Protection levels: making rules stricter is always immediate; loosening them can ask for a
  confirmation, a wait or a cooling-off period. The emergency exit always works.
• Why?: see which rule applies to a page and when that changes.
• Insights: time and visits per day, rule and site.
• Private: no account, no server, no telemetry. Everything stays on your device.

Limitations: WebHandbrake works inside one browser profile. It cannot cover other browsers or
devices, and it cannot prevent its own removal. The user guide lists every limit:
https://github.com/fabiomolignoni/WebHandbrake/blob/main/docs/user-guide.md
```

## Chrome Web Store

- **Category**: Workflow & Planning.
- **Language**: English.
- **Permission justifications**: for each permission, paste its cell from the column "What
  WebHandbrake uses it for" of [the permissions table](../PRIVACY.md#permissions). The dashboard
  lists the permissions of the uploaded package, so a permission without a row there means that
  the table must be updated first.
- **Remote code**: No, I am not using remote code. Every script is in the package, and the content
  security policy of the extension pages is
  <!-- fact: manifest.csp|code -->`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' data:; style-src 'self'; connect-src 'self'`<!-- /fact -->.
- **Data usage**: tick these types. Each is processed and stored only on the device, and never
  transmitted.
  - **Web history**: statistics per site and day, the pages saved for later, and the recent
    decisions kept until the browser closes.
  - **User activity**: how long ago the keyboard, mouse or touch screen was last used, and whether
    the device is idle, to count active time. Keystrokes are not recorded.
  - **Website content**: the titles of the pages saved for later, and the text of the field being
    typed in, which is read inside the page for the grace period and never stored.
- **Not ticked**: personally identifiable information, health, financial and payment information,
  authentication information, personal communications and location. The settings password
  protects WebHandbrake's own settings, not an account; it is stored only as a salted hash.
- **Certifications**: tick all three: no sale or transfer of user data outside the approved use
  cases, no use or transfer for purposes unrelated to the single purpose, and no use or transfer to
  determine creditworthiness or for lending.
- **Privacy policy**: the address under [Shared texts](#shared-texts).

## Firefox Add-ons

- **Summary** (at most 250 characters, no links): the short description of
  [Shared texts](#shared-texts).
- **Description**: the text of [Description](#description).
- **Category**: Other. No Firefox Add-ons category describes tools that limit websites.
- **Platforms**: Firefox and Firefox for Android.
- **Licence**: GNU General Public License v3.0 or later (`GPL-3.0-or-later`).
- **Support site**: the support address under [Shared texts](#shared-texts).
- **Privacy policy**: the address under [Shared texts](#shared-texts).
- **Data collection**: none. The manifest declares it
  (<!-- fact: manifest.dataCollection|code -->`none`<!-- /fact -->), and Firefox shows it when the
  extension is installed.
- **Source code**: yes, because the code is bundled. Upload the archive made by
  `npm run package:source`; the build instructions are in
  [Build from source](releasing.md#build-from-source).

### Notes for reviewers

```text
How to see the main flow in two minutes:
1. Install the add-on. The setup opens: choose a goal, pick a ready-made list or type a site,
   choose what happens (for example "Wait") and choose "Turn on my plan". If Firefox has not
   granted access to websites, choose "Allow access" in the setup first.
2. Open one of those sites: the intervention page replaces it.
3. In the dashboard, open the rule and remove a site. At the Balanced protection level, the
   default, the change applies only after a short wait.

Permissions: access to all sites is needed to check each address against the rules and to
redirect a restricted page to the intervention page before it loads. "tabs" reads the address of
open tabs, including browser pages. "webRequest" only observes the Date header of top-level pages
to detect a manipulated system clock; nothing is blocked or changed. Each permission is explained
in PRIVACY.md (section Permissions) and in docs/adr/0009-permissions.md.

Code: there is no remote code. The only bundled library is Preact (MIT). The bundles are not
minified. The UNSAFE_VAR_ASSIGNMENT warnings of web-ext lint come from Preact's handling of
innerHTML in the bundled pages; WebHandbrake's own source assigns innerHTML once, to a constant
string, in src/content/overlay.ts.

Data: nothing is collected or transmitted, as declared in data_collection_permissions.
```

## Screenshots

The Chrome Web Store needs at least one screenshot of 1280 × 800 pixels (or 640 × 400), and up to
five, plus a small promotional image of 440 × 280 pixels. Firefox Add-ons accepts the same
screenshots. Take them by hand at each release, in the light theme and with the English interface,
showing for example the popup on a restricted site, an intervention page, the rule wizard,
Insights and the Protection page. The end-to-end variable `WHB_SCREENSHOTS`
([testing.md](testing.md#environment-variables)) saves every dashboard page as a starting point.
