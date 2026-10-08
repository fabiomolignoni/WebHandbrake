# Accessibility statement

Last reviewed: 2026-10-08

This statement covers the WebHandbrake browser extension.

## Commitment

WebHandbrake aims to be usable with a keyboard, with screen readers, with browser zoom and with
high contrast. The target is level AA of the Web Content Accessibility Guidelines (WCAG) 2.2.

## Conformance status

WebHandbrake has not been evaluated for conformance with WCAG 2.2 AA. Automated checks run on every
change, but they find only part of the barriers that a manual evaluation would find.

## Scope

The statement covers what WebHandbrake draws itself:

- the popup;
- every page of the dashboard, every step of the rule wizard and every step of the setup shown
  after installation;
- the intervention pages that replace a restricted page;
- the small panels that WebHandbrake shows inside web pages: the timer, reminders, warnings and the
  grace period.

It does not cover what the browser draws (the toolbar button, the right-click menu, the extension
settings) or the websites themselves.

## How it is evaluated

- **Automated checks.** The end-to-end tests run axe-core with the rule tags
  <!-- fact: test.axeTags|code -->`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`<!-- /fact -->
  in Chromium and Firefox, on every pull request and every change to the `main` branch. They check
  every dashboard page, an open condition, a menu, every step of the rule wizard and of the setup,
  in the light and dark themes, and the popup and the intervention pages in the light theme. The
  panels inside web pages are not checked.
- **Keyboard scenarios.** Tests check that the first Tab reaches the skip link, that radio buttons
  move with the arrow keys, that dialogs keep the focus and close with Escape, that the
  intervention page puts the focus on its title, and that its countdown is announced every ten
  seconds rather than every second.
- **Manual evaluation**: none.
- **Screen readers**: not tested.
- **Firefox for Android**: not evaluated.

## Known limitations

- The panels inside web pages follow the system's light or dark appearance, not the theme, **High
  contrast** or accent colour chosen in **Settings › General**.
- Animations are reduced only through the system's reduced-motion setting; WebHandbrake has no
  setting of its own.
- How often the countdown of a wait is announced has not been checked with people who use screen
  readers.
- Some steps have time limits. A wait, challenge or confirmation that you have started expires
  after <!-- fact: limits.TICKET_TTL_MS|minutes -->60<!-- /fact --> minutes, and a pending change
  must be confirmed within
  <!-- fact: defaults.settings.protection.confirmHours -->48<!-- /fact --> hours after its
  cooling-off period.
- Completing the emergency exit needs a sentence to be typed.
- Waits and challenges are part of what you choose WebHandbrake to do. A challenge drawn as an image
  offers **I use a screen reader: type a sentence instead**. Every intervention and break cost can
  be one that needs no typing or waiting, and the **Soft** protection level asks only for a
  confirmation. The [user guide](user-guide.md#accessibility) explains how.

## Compatibility

The browsers and versions that WebHandbrake supports are listed in
[Supported browsers](../README.md#supported-browsers).

## Feedback

Report a barrier with the
[Accessibility problem form](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose).
Questions go to
[GitHub Discussions, category Q&A](https://github.com/fabiomolignoni/WebHandbrake/discussions/categories/q-a).
WebHandbrake is a volunteer project: replies are given on a best-effort basis, with no promised
response time.
