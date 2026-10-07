# Interface design

## Scope

These are the rules for anyone who changes WebHandbrake's interface or its text: the popup, the
dashboard, the intervention pages, the in-page overlay and every message in
`src/locales/en.json`. They describe the interface as it is and the rule behind each part. The
reasons and the research behind the product are in [Principles and evidence](principles.md); the
normative behaviour is in the [requirements](requirements.md); interface words are mapped to code
names in the [glossary](glossary.md).

## Principles

- **Status first.** Every surface starts with what is happening: a tone, an icon and words, plus
  the time left or the end time when there is one.
- **One visual language for the friction ladder.** An intervention has the same tone, icon and name
  on every surface ([Status language](#status-language)).
- **Healthy choice first, honest choice always** (principle G3). The way out is the primary
  button; the alternative is visible, labelled and shows its cost before it is paid.
- **Quiet by default.** Neutral chrome. Colour marks state and the primary action; red marks only
  destructive actions.
- **Everything about a rule on one page,** with progressive disclosure for the rare options.
- **Fewer controls, direct manipulation.** Whole rows are clickable, rare actions live in menus,
  and short exclusive choices are segmented controls.
- **Asymmetric control.** Making rules stricter is one step; loosening them says what it costs and
  when it applies (principle G2).
- **Accessible by construction** ([Accessibility](#accessibility)).

## Surfaces

| Surface | Code | What it is for |
|---|---|---|
| Popup | `src/popup/index.tsx` | The state of the current site and quick actions. On Firefox for Android it opens as a full page. |
| Dashboard | `src/dashboard/` | Everything else: rules, focus sessions, statistics, protection, settings, help, first run. |
| Intervention pages | `src/intervention/index.tsx` | The page shown instead of a site: block, wait, question, challenge, closing or redirecting, focus session, cool-down, protected browser page and the blocking self-test. |
| In-page overlay | `src/content/overlay.ts` | Timer, reminders, the recalled intention, warnings before a restriction starts and the grace period, in a closed shadow root that the site's styles cannot reach. |
| Notifications | `src/background/notifications.ts` | Off until the person turns them on in **Settings**, which asks for the permission at that moment. |
| Context menu and shortcuts | `src/background/menus.ts` | Desktop only, and only where the browser offers them. |

## Navigation and layout

- The dashboard has eight destinations in two groups: **Today**, **Rules**, **Focus**, **Insights**;
  then **Later**, **Protection**, **Settings**, **Help** (`NAV_PRIMARY` and `NAV_SECONDARY` in
  `src/dashboard/index.tsx`). **Shared lists** and **Always allowed** are sub-pages of **Rules**,
  reached through navigation links, not tabs.
- On wide windows the sidebar shows labels and, at its foot, the protection level, a running focus
  session and pending changes. On medium widths it shows icons only. On narrow screens a bottom bar
  holds the four primary destinations and **More** for the rest. The pending-changes count sits on
  **Protection** and on **More**. The widths are the media queries for the `shell` class in
  `src/ui/styles/index.css`.
- A **Skip to content** link comes first. Each page sets the document title to its name.
- First run has no navigation: it is a single centred column.
- Every route is a hash route (`#/groups/<id>`); leaving a page with unsaved changes asks for
  confirmation (`setNavigationGuard()` in `src/dashboard/router.ts`).

## Status language

- **Six tones.** `free` (nothing stands in the way), `gentle` (a light touch while browsing),
  `friction` (a pause before going in), `protected` (the page is replaced or closed), `calm` (a
  break or granted access in progress) and `neutral` (nothing applies, or the rule is off).
- **The mapping lives in code.** Which intervention gets which tone and icon is defined by
  `toneOf()` and `interventionIcon()` in `src/ui/status.ts`; documents link it and do not copy it.
  The status sentences of pills and the popup headline come from the same file.
- **A tone never appears alone.** It always comes with an icon and words (`StatusPill`,
  `ToneIcon`).
- **The friction meter** (four notches from `free` to `protected`) appears only in the popup, as
  decoration next to the words. Pickers show the ladder with a **Gentler** / **Stronger** scale.
- **Two orders.** Pickers list interventions in the order of `LADDER` in `src/ui/status.ts`. Which
  result wins between rules follows `SEVERITY` in `src/engine/decide.ts`, where **Redirect** is as
  strict as **Block** and **Close the tab** is the strictest.

## Popup

- **Header:** the logo, a level chip that opens **Protection**, and the primary **Dashboard**
  button.
- **Hero:** tinted by tone, with the tone icon, the host (and a "private" tag in private windows),
  a headline with the most useful fact (time left, end time, "No rules on this site"…), the
  friction meter, the limit bar with **Stop for today**, the next change, the rules that apply and
  **Why?**, which expands the explanation in place.
- **Tiles:** **Take a break** (its cost and the breaks left are inside the tile, or the reason it is
  unavailable), **Save for later** and **Block site**. **Block site** opens **Block this site**: the
  granularities as radio cards, each previewing the entry it adds, and the rule to add it to.
- **Focus panel:** shown only when at least one rule is included in quick focus sessions; durations
  are `QUICK_SESSION_MINUTES` in `src/engine/limits.ts`. A running session replaces it with a
  ring, the end time, an extension button and, unless it cannot be interrupted, **End now**.
- **Footer:** today's time on limited sites and **Details**, which opens **Insights**.
- Opening a dashboard page closes the popup only after the page has opened.

## Today

- A date overline, the title, one status sentence (active rules, restricted now, next change) and
  the protection level as a pill that opens **Protection**.
- Real problems are banners. Setup steps, such as allowing private windows, sit in a quiet
  **Finish setting up** card, never in an alert.
- **Right now** lists active rules with their status pill and limit bar; **Coming up** is a
  timeline; **Breaks in progress** appears only during a break; **Focus session** starts one in a
  tap; **Today's numbers** shows zeros quietly.

## Rules list

- **New rule** is the primary action. Search covers names and sites; a segmented filter shows
  **All**, **Active**, **Off** or **Archived**.
- Each rule is one clickable row: icon tile, name, sites preview, conditions summary, status pill,
  an on/off switch with immediate effect, and an overflow menu (**Edit**, **Duplicate**, **Share**,
  **Move up**, **Move down**, **Archive**).
- A rule shows its own protection level only when it differs from the global one.
- Rows can be dragged; the menu's **Move up** and **Move down** are the alternative. A note says
  that order is for convenience only: the strictest result always wins.

## Creating and editing rules

Creating a rule is infrequent and done by people who do not know the concepts yet, so it is a
wizard. Editing is frequent, so it is one page.

- **Wizard** (`src/dashboard/pages/group-wizard.tsx`, ONB-08): **Sites**, **When**, **What happens**
  and **Review**. The review states the plan as one if-then sentence (`planSentence()` in
  `src/dashboard/plan.ts`) before **Create rule**.
- **Wizard conventions.** Steps are visible and named. Next buttons say where they go (**Next:
  when**) and stay disabled until the step is valid. Focus moves to each step's heading. Completed
  steps can be revisited. The state is kept for the browser session and resumes with **Start over**
  offered.
- **Active choice** ([ADR 0008](adr/0008-active-choice.md)): no option of **What should happen?**
  is pre-selected or marked as recommended. Only a redirect asks for its setting; every other
  intervention starts from defaults that the editor can refine.
- **The full editor** is always one link away (**Use the full editor**, **Customise all options
  first**) and receives the draft. `#/groups/new?full=1` opens it directly.

## Rule editor

- **Identity:** the rule's tile, name, on/off switch and personal reason (**Why does this rule
  matter to you?**). The tile opens the colour and icon choices.
- **Sections:** **Sites**, **When & how**, **Breaks**, **Block page**, **Protection** and
  **Advanced**, as cards on one page, with a section navigation that follows the scroll.
- **Conditions** read as sentences ("condition → status pill") and open in place into **When**,
  **Limit** and **Then**. **Then** is the intervention picker. A last line states what happens
  otherwise. Buttons add a time window, a time limit or friction at all times.
- **Side panel:** **In brief** (each condition with its tone), **Things to check** (validation, by
  severity) and **Test a URL**.
- **Save bar:** sticky, with **Create rule** or **Save changes**, **Discard changes**, the unsaved
  state and the error count; **Share** and **Delete rule** are in its menu.
- The on/off switch applies at once without saving the draft. While nothing is being edited, the
  editor follows changes made elsewhere.
- When a strictly protected rule is active, a banner says that it can be made stricter but not
  loosened until it is no longer active.

## Intervention page

- **Layout:** one centred panel. An emblem says what kind of pause this is; the headline is calm
  ("This space is protected until 17:00", "Take a breath.") and receives the focus.
- **Context:** the rule's personal reason as a quote, its custom message, the host (unless the rule
  hides addresses), the rule's name and **Why?**, one interaction away.
- **The choice is one card.** For a wait, a question or a challenge, the step comes first (a
  breathing ring with its countdown; suggestions, free text and a duration; the code to type), then
  the two buttons: the primary closes the tab (**Close the tab**, or **Not now — close the tab**
  after a question) and the secondary continues (**Continue**, **Continue for {minutes} min**). The
  secondary button stays disabled while a wait runs. Without a step, **Close the tab** is the only
  primary button.
- **Other ways out:** **Go back**, **Save for later**, the person's alternatives under **Instead,
  you could**, and **Take a break** with its cost, or the reason a break is unavailable.
- When the restriction ends, the page offers **Reopen the page**, or reopens it if the person chose
  that.
- The page refuses to run inside a frame (SEC-08).

## Break dialog

`PauseDialog` in `src/ui/pause.tsx`. The person picks what the break covers and for how long; the
cost and the breaks left are shown before anything is paid. **Not now** is the primary button and
**Start the break** the secondary one. A cost is then paid in the cost dialog (`TicketDialog` in
`src/ui/ticket.tsx`), whose primary button is **Keep my rules**.

## Focus

- A running session is a card with a ring, its end and, unless it cannot be interrupted, the way to
  end it early, which follows the protection level.
- Setting one up: a duration (the quick durations, a longer one, or an end time), the mode (**Some
  of my rules** or **Everything except a few sites**), a start delay, **No breaks during the
  session** and **Cannot be interrupted**.
- A session that cannot be interrupted, or that leaves only a list of sites open, opens **Before
  you start** first. It says until when the session lasts, that every other site will be blocked
  when only a list stays open, and that only the emergency exit ends early a session that cannot be
  interrupted. **Cancel** is its primary button.

## Protection

The page shows, in order: pending changes (when there are any), the protection level with what it
means for loosening and for breaks, **Fine-tune the levels**, **How solid is your protection?**,
**Access requirements**, **Emergency exit** and **Events**. Choosing **Locked** asks for an end date
in a preview first. Every refused change says why and points to the emergency exit.

## Insights

- A period selector, totals, comparisons and charts. Every chart has a table with the same data.
- Exports are CSV or JSON.
- Deleting statistics explains that the totals that limits need are kept, so deleting never
  refills a limit (`BUDGET_KEEP_DAYS` in `src/engine/limits.ts`).

## First run

`src/dashboard/pages/welcome.tsx` (ONB-01).

- **Welcome:** three value points and two buttons of the same size: **Set up in about a minute**
  (primary) and **Skip setup**.
- **Steps:** **Installed** shows as done, then **Your goal**, **Sites**, a details step and **Your
  plan**. The details step depends on the goal (hours, daily time or what happens) and is skipped
  when the goal implies the intervention (blocking completely, or only counting time).
- **Active choice:** no goal and no intervention is pre-selected or recommended
  ([ADR 0008](adr/0008-active-choice.md)). The chosen intervention shows a miniature of what it
  looks like on a site.
- **Sites:** ready-made lists as tiles and the person's own sites, always visible, with a live
  summary of the rules and sites that will be created.
- **Your plan:** the if-then sentence, the rules to be created, the optional personal reason and
  **How firm should it be?** with **Soft**, **Balanced** and **Strict**; **Locked** is offered only
  on **Protection**. The current level starts selected because it is the extension's state, not a
  recommendation. Access to websites is asked here, in context, only when it is missing.
- **You're set:** next steps the page cannot do itself: pin the toolbar button, try a site, allow
  private windows when they are not allowed.
- The setup resumes within the browser session. Once it is completed or skipped, nothing in the
  interface opens it again; further rules come from **New rule**.

## Address guide

Next to every sites input, a collapsed **How to write an address** lists what people want to do,
each with an example (a whole site, every country, one subdomain, one exact host, a section, a
single page, the home page, a wildcard, an exception). Picking an example puts it in the input,
selected and ready to edit; a link opens the full syntax in **Help**. Pasted lists are converted
line by line, and a sentence pasted by mistake is reported once, not once per word
(`src/dashboard/components/targets.tsx`).

## Sensitive lists

The ready-made lists marked `sensitive` in `src/data/templates.ts` (gambling and adult sites) never
show their addresses unless the person asks (LST-05). First-run tiles show only a count, rule rows
and plan sentences count those sites without naming them, the sites editor folds them into one row
with **Show**, and none of their addresses becomes a rule name or an example.

## Writing

This is the single writing standard for interface text and for the documentation.

- **Language.** UK English (colour, behaviour, organise, licence as a noun). Code identifiers keep
  their spelling.
- **Voice.** Second person, active voice, present tense, short sentences, one idea per sentence.
  Headings in sentence case; one H1 per document; no skipped heading levels.
- **Words.** User-facing text uses interface terms only ([glossary](glossary.md)). Contributor
  documents may use code terms, with a link to the glossary the first time in each file.
- **Labels.** Write interface labels exactly as in `src/locales/en.json`, in bold when they name a
  control.
  Menu paths use `›` (**Settings › Time**).
- **Timeless.** State what is true. Never write `currently`, `recently`, `soon`, `in a future
  version` or `not yet available`; plans belong only in the [roadmap](roadmap.md) and in planned
  requirements.
- **Numbers.** A number that comes from code reaches interface text as an ICU parameter, never typed
  into a message ([ADR 0005](adr/0005-i18n.md)). In user-facing documents, in
  [releasing](releasing.md) and in the [data format](data-format.md) it is a fact marker. Other
  contributor documents cite the constant by name and file, or use a fact marker, and never type a
  number that duplicates it
  ([How these documents stay correct](README.md#how-these-documents-stay-correct)).
- **References.** No requirement IDs in user-facing text. No line numbers anywhere: cite a file, a
  symbol or a test title. Status is a word, never an emoji. Dates are ISO 8601.
- **Honest claims.** Never write `cannot be bypassed`, `WCAG 2.2 AA conformant`, `proven`, `fully
  tested` or any wellbeing or addiction claim. Say "designed after" research. Limit "reproducible"
  to what it covers. The privacy policy does not hedge about what the extension does.
- **Links.** Link text names the target, never "click here". Link relatively inside the
  repository. A diagram is followed by prose that says the same.
- **Tone.** Calm and non-judgemental: "This space is protected until 17:00", never "ACCESS
  DENIED"; "times you chose not to go in", with no rankings and no "wasted time".
- **Errors** say what happened, why and what to do. **A loosening** says when it can be confirmed.
- **Search words stay where people look.** The interface calls the main object a rule, yet keeps
  "Block site" in the popup and "Block, limit or slow down the sites you choose" on **Rules**
  ([ADR 0007](adr/0007-interface-terms.md)).
- **Translators.** Add a `description` to a message in `src/locales/en.json` when its meaning or
  its placeholders are not obvious.
- **Generated files** are never edited by hand; change their source.

## Visual language

- **Tokens.** Colours, spacing, radii and type sizes are semantic custom properties in
  `src/ui/styles/index.css`. Use the tokens; do not copy their values into components or
  documents.
- **Themes.** Light, dark (following the system unless the person chooses) and high contrast. Only
  system fonts; nothing is loaded from the network.
- **Brand colour.** The default accent (`DEFAULT_ACCENT` in `src/engine/defaults.ts`) is a muted
  indigo, distinct from the state tones and tuned per theme to meet WCAG AA contrast. A custom
  accent from **Settings** is applied as chosen, and high contrast ignores it.
- **Shapes.** Buttons are for actions and pills for states and choices, so the two never look
  alike. Cards are flat with a border; the strong shadow (`--shadow-lg`) is only for layers:
  dialogs, menus, toasts and the **More** sheet.
- **Targets** follow the `--target` token, larger on coarse pointers.
- **Known limitation:** the in-page overlay keeps its own palette and does not follow the theme,
  high contrast or the accent.

### Components

The shared components are in `src/ui/components.tsx`; use them before writing new ones.

| Component | Use it for |
|---|---|
| `Button`, `IconButton` | Actions; one primary per view. An icon-only button always has a label. |
| `Toggle` | A setting with immediate effect: label and help first, switch last; never next to a save button. |
| `Segmented` | Two to five short, exclusive options. |
| `RadioCards` | Exclusive options that need a description or an icon, such as the intervention picker. |
| `Chips` | Short exclusive options inside a dialog. |
| `StatusPill`, `ToneIcon` | A state, always as tone, icon and words. |
| `FrictionMeter` | The popup's decorative meter only. |
| `Ring`, `Progress` | A session's or a wait's progress; a limit's use. |
| `Menu` | Rare actions of a row or a page. |
| `Field`, `NumberInput`, `Select` | Form fields with their label, help and error. |
| `Banner` | A problem or an outcome, with an action when there is a remedy. |
| `Empty` | An empty view, with its call to action. |
| `Dialog` | A modal choice. |
| `toast` | A short confirmation that needs no action. |
| `GroupTile`, `ColorDot` | A rule's icon and colour. |

Collapsible sections use the native `details` element with the `disclosure` class. Feature
components live next to their pages (`src/dashboard/components/`) and in `src/ui/`
(`PauseDialog`, `TicketDialog`, `Explain`).

## View states

Every view handles five states:

- **Empty:** says what is missing and offers the action that fills it.
- **Loading:** a short status message.
- **Error:** says what happened and the remedy.
- **Restricted:** says why and until when (locked settings, an active strictly protected rule, a
  focus session).
- **Pending:** a loosening waiting for its cooling-off shows when it can be confirmed and how to
  cancel it.

## Accessibility

A contributor checklist. How it is tested: [testing](testing.md). What users are told:
[accessibility statement](accessibility.md).

- Tones never appear alone; charts have a table alternative.
- Text contrast at least 4.5:1 and component boundaries at least 3:1, in every theme.
- A visible focus outline (`:focus-visible` in `src/ui/styles/index.css`); focus is never hidden
  under sticky bars, thanks to `scroll-padding` (WCAG 2.4.11).
- Segmented controls, radio cards and chips use a roving tab index with the arrow keys.
- Menus follow the menu-button pattern; dialogs are native modal dialogs that restore focus.
- Focus moves to the new heading when a wizard step or an intervention page changes.
- Countdowns are announced at a moderate pace, not every second (A11Y-03).
- Motion follows the system's reduced-motion setting; there is no option inside WebHandbrake.
- Dragging always has an alternative: the menu for rule order, fields and day buttons for the week
  grid (WCAG 2.5.7).
- No page needs horizontal scrolling at the narrow width that A11Y-06 sets. Automated checks
  confirm it in Chromium; Firefox keeps a wider minimum window.
- Every typed challenge has a non-visual alternative (A11Y-05). Fields for challenges and for the
  settings password refuse paste and synthetic input (`TypingInput` in `src/ui/ticket.tsx`).
