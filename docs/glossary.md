# Glossary

The interface and the code name some things differently: the interface says "rule" where the code
says `Group`. This table maps each interface term to its label in `src/locales/en.json` and to its
name in the code.

- In user-facing text (README, PRIVACY, SECURITY, SUPPORT, CHANGELOG, the user guide, the
  accessibility statement, the store listings, the issue forms and the interface strings), use the
  interface term exactly as its label writes it.
- In contributor documents, a code name may appear; link to this glossary the first time it does in
  each file.
- In the last column, words in backticks never appear in user-facing text, except in the allowed
  phrases listed. Words in italics are ordinary English too: avoid them only in the sense given.

## Terms

| Interface term | Label key | Meaning | In code | Avoid in user-facing text |
|---|---|---|---|---|
| Rule | `nav.groups` | A named set of sites with its conditions, break settings, block page and protection level. | `Group` (`src/engine/types.ts`), `config.groups`, route `#/groups` | `group`, `groups` |
| Condition | `policy.number` | One line of a rule: when it applies (always or a schedule, optionally with a limit) and what happens then. Conditions are checked from top to bottom, and the first that applies decides. | `Policy`, `group.policies` | `policy`, `policies` (allowed phrases: privacy policy, security policy, this policy, enterprise policy, enterprise policies, system policies, content security policy, User Data Policy, add-on policies, program policies) |
| Sites | `editor.section.sites` | The addresses a rule covers, one entry each, written in the address syntax shown in Help. | `Target` (`type`, `value`), `group.targets`; shared lists through `group.lists` | *target* |
| Exceptions | `targets.exceptions` | Entries written with `+` that allow part of a site that the same rule restricts. The most specific entry wins. | `Target` with `allow: true` | — |
| Shared lists | `nav.lists` | Lists of sites that several rules reuse. | `SharedList`, `config.lists`, route `#/lists` | — |
| Always allowed | `nav.allowlist` | Sites that are never restricted, whatever the rules and focus sessions say. | `config.allowlist`, route `#/allowlist` | `allowlist`, `whitelist` |
| Ready-made lists | `wizard.sites.templates` | Lists of sites to start a rule from, offered in the rule wizard and in the first-run setup. | `TEMPLATES`, `TemplateDef` (`src/data/templates.ts`) | `template`, `templates` |
| Sensitive list | `targets.hidden` | A ready-made list whose addresses stay hidden unless the user asks to see them; only their number is shown. | `sensitive: true` on a `TemplateDef` | — |
| Limit | `budget.label` | An optional part of a condition: the condition applies once the limit is used up. | `Budget`, `policy.budget` | `budget`, `budgets` |
| Time | `budget.kind.time` | A limit on the time spent in a period. | `TimeBudget` (`type: 'time'`) | — |
| Visits | `budget.kind.visits` | A limit on the number of visits in a period, optionally also on the length of each visit. | `VisitBudget` (`type: 'visits'`) | — |
| Continuous use | `budget.kind.session` | A limit on uninterrupted use, followed by a mandatory stop. | `SessionBudget` (`type: 'session'`) | — |
| Cool-down | `why.cooldown` | A period during which a site stays restricted. After continuous use, the condition itself applies. After the time chosen at an Ask what I want to do question, the site is blocked. | `Cooldown`, `state.cooldowns`: `kind: 'session'` (LIM-05) and `kind: 'ask'` (LIM-06) | — |
| Visit | `settings.visitGap` | Time on a rule's sites without a long enough absence. Coming back after the visit gap starts a new visit. | `settings.tracking.visitGapMinutes`, `Activity.visitStart` | — |
| Days start at | `settings.dayStart` | The time at which a new day begins for time windows, daily limits and daily statistics. | `settings.dayStart` (minutes after midnight); the logical day of `logicalDayOf()` in `src/engine/time.ts` | — |
| Time counted | `status.type.track` | The state of a site that a rule covers but does not restrict at that moment: time is counted and nothing else happens. | result type `track` | *tracked* |
| Only count time, Reminder, Filter, Ask what I want to do, Wait, Challenge, Block, Close the tab, Redirect | `intervention.track`, `intervention.remind`, `intervention.filter`, `intervention.ask`, `intervention.delay`, `intervention.challenge`, `intervention.block`, `intervention.close`, `intervention.redirect` | What happens when a condition applies: the interventions. | `InterventionType`: `track`, `remind`, `filter`, `ask`, `delay`, `challenge`, `block`, `close`, `redirect` | *delay* and *track* as names of interventions |
| Allowed | `intervention.allow` | Nothing restricts the site. | `allow` | *free* as the name of a state |
| Intervention pages | `settings.pages` | The extension page shown instead of a restricted page. | `intervention.html` (`src/intervention/index.tsx`) | — |
| Block page | `editor.section.page` | The section of the rule editor that sets what the user sees when the rule stops them: the message on the intervention page and the on-page timer. | `group.message`, `group.options.timer` | — |
| Take a break; Breaks | `pause.title`, `editor.section.breaks` | A break suspends the interventions of a page, a site, a rule or all rules for a while. The Breaks section of a rule sets whether breaks are allowed, how long they last, how many there can be and what they cost. | a `Grant` with `kind: 'pause'`; `group.pause` (`PausePolicy`); `state.pauses` | *grant*, *grants* |
| After passing, allow | `grant.label` | The access given after answering a question, waiting or completing a challenge: to the page, the site or the rule, for the visit or for a set time. | `GrantSpec` (the intervention's `grant`); a `Grant` with `kind: 'pass'` | *pass* as a noun |
| Focus session | `focus.start` | A period during which the sites of the chosen rules, or every site except a short list, are blocked. | `FocusSession` (`kind: 'groups'` or `'allowlist'`), `state.sessions` | `lockdown` |
| Cannot be interrupted | `focus.locked` | A focus session that can end early only through the emergency exit. | `FocusSession.locked` | — |
| Include in quick focus sessions | `editor.quickSession` | The rule option that puts a rule in the focus sessions started from the popup, the keyboard shortcut or the context menu. | `group.options.quickSession` | — |
| Protection level: Soft, Balanced, Strict, Locked | `protection.level`, `level.soft`, `level.balanced`, `level.strict`, `level.locked` | How hard it is to loosen the rules. The extension has one level, and a rule can have its own. | `settings.protection.level`, `group.protection` | — |
| Loosening | `access.codeHelp` | A change that makes the rules less strict. It costs what the protection level asks. | a `ChangeUnit` with the `Direction` `weaken` (`src/engine/changes.ts`) | `weaken`, `weakening` |
| Stricter | `protection.levelHelp` | A change that makes the rules stricter. It always applies at once. | a `ChangeUnit` with the `Direction` `strengthen` | `strengthen`, `strengthening` |
| Pending changes | `protection.pending` | Loosening changes that wait for their cooling-off period, then for a confirmation. | `PendingChange`, `state.pending` | — |
| Cooling-off | `protection.coolingOff` | At the Strict level, the wait before a pending change can be confirmed. | `settings.protection.coolingOffHours` | — |
| Settings password | `access.passwordTitle` | Asked before any change that does not make the rules stricter. Only a salted hash is stored. | `settings.protection.access.passwordHash` | — |
| Random code to type | `access.code` | A random code to retype before loosening the rules. | `settings.protection.access.codeLength` | — |
| Times when settings cannot be loosened | `access.windows` | Time windows in which only changes that make the rules stricter are possible. | `settings.protection.access.lockWindows` | `lock windows` |
| Emergency exit | `emergency.title` | The way out of settings that are too strict: request it, wait, then type a sentence. It ends the focus sessions, sets protection to Soft and removes the password, the code and the time windows. | `state.emergency`; `emergency.complete` in `src/background/protection.ts` | — |
| Events | `protection.tamper` | The protection log: changes of the system clock, settings restored from a backup, removed access to all sites or to private windows, browser blocking filters that did not match the settings, times the extension was not running, and the emergency exit. | `TamperEvent`, `state.tamper` | `tamper` ("tampering" is plain English and allowed) |
| Protection | `nav.protection` | The page with the protection level, pending changes, the checklist, the access requirements, the emergency exit and the events. | route `#/protection` | `protection centre` |
| Browser blocking filters | `diag.rules` | The filters the extension installs in the browser so that restricted pages stop before they load. | `declarativeNetRequest` dynamic rules (`src/background/dnr-sync.ts`) | `DNR`, `declarativeNetRequest` (permission names in code spans are not checked); *rule* for a browser filter |
| Recent decisions; Keep a log | `diag.log`, `diag.logEnabled` | What the extension decided for recent pages, shown in Settings › Diagnostics and kept in the browser's session storage. | the decision log (`src/background/diagnostics-state.ts`), `settings.diagnostics.decisionLog` | — |
| Later; Save for later | `later.title`, `iv.saveLater` | Pages saved from an intervention page or the popup, to open when they are allowed. | `LaterItem`, `store.later` | — |
| Insights | `insights.title` | The statistics page. | statistics, `DayRecord` (`src/background/stats.ts`) | `stats` |
| Why? | `popup.why` | The popup's explanation of what applies to the current page and when that changes. | the `explain` request (`src/background/explain.ts`) | — |
| Test a URL | `test.title` | The rule editor tool that shows what the rule being edited would do on an address. | the `explain` request with `draftGroup` (`src/dashboard/components/test-url.tsx`) | — |
| Advanced mode | `settings.advanced` | Shows regular expressions, rolling windows, per-site limits, text editing of lists and other options. | `settings.advanced` | `expert mode` |
| Track time on all sites | `settings.allSites` | Counts time on every site, not only on the sites of rules. | `settings.tracking.allSites` | — |
| Detect a manipulated system clock | `settings.dateHeaders` | Compares the system clock with the date of pages the browser loads anyway. | `settings.clock.useDateHeaders` | — |
| Dashboard | `popup.dashboard` | The extension's main page, where rules and settings are managed. | `dashboard.html` (`src/dashboard/index.tsx`) | — |
| Welcome | `nav.welcome` | The first-run setup. | route `#/welcome`, `settings.onboarded` | `onboarding` |
