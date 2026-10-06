# UI/UX redesign (v1.1)

This document records the audit of the v1.0 interface, the research the redesign is based on and
the resulting design. It complements §8 of [`requisiti.md`](requisiti.md) (UX principles,
information architecture, wireframes) without changing the functional requirements.

- Status: implemented on branch `ui/redesign` (to be validated with users, §8)
- Surfaces: popup, dashboard (all pages), intervention page; onboarding and the remaining pages
  inherit the new design system
- Iteration 2 (§10): "Groups" renamed to "Rules", and a step-by-step wizard to create one; §2–§9
  keep the original word "group"
- Iteration 3 (§11): first run rebuilt around active choices, new brand colour, hidden addresses
  for sensitive lists, "Allowed" for unrestricted states, a short guide for writing addresses, a
  labelled Dashboard button in the popup, links to the source code and issues
- Unchanged: rule engine, data model, permissions. Two small supporting changes: the popup model
  carries the global protection level (header chip), and `targetFor` moved from the background to
  `engine/page-target.ts` so that the popup can preview the entry it will add

## 1. Method

1. **Code and screenshot audit** of every surface in light and dark themes, at 1280 px and 390 px,
   with a realistic configuration (three groups: a block, a schedule plus a daily limit, an
   intention question).
2. **Heuristic evaluation** against Nielsen's ten heuristics, the NN/g guidelines for the patterns
   in use (tabs, cards, toggles, progressive disclosure, indicators, dashboards) and WCAG 2.2 AA.
3. **Literature review** of digital self-control research (CHI, PNAS, IMWUT) to keep the design
   aligned with what is known to work for this kind of tool.
4. **Competitive and cross-domain analysis**: digital wellbeing apps and extensions, operating
   system features, and products from other domains that solve similar interaction problems
   (rule builders, status dashboards, settings).

## 2. Audit of v1.0

Severity: **H** high (hurts the core tasks), **M** medium, **L** low.

### 2.1 Cross-cutting

| # | Finding | Heuristic / source | Sev |
| --- | --- | --- | --- |
| X1 | State is never encoded visually. "Block", "Allowed until…", "Ask what I want to do" are grey text in the same style; the only colour is the accent, used for primary buttons, selected chips, toggles, links and progress alike. The user cannot tell at a glance whether a site is free, slowed down or blocked. | Visibility of system status (Nielsen #1); preattentive attributes (NN/g, dashboards) | H |
| X2 | Every block of content is a white card with the same border, shadow and `h2`: pages read as a uniform stack ("card soup") with no hierarchy between primary and secondary content. | NN/g, cards: use them for heterogeneous, browsable content, not for everything | M |
| X3 | Buttons, chips (radio groups) and tags share the same pill shape and border: actions, choices and labels are hard to tell apart. | Consistency and standards (#4); Material 3 / Apple HIG: segmented controls for 2–5 exclusive options | M |
| X4 | Underlined links everywhere ("All groups", "More options…", "Why?", "Open the dashboard →") add noise and compete with actions. | Aesthetic and minimalist design (#8) | L |
| X5 | Text inputs and selects have a border with ≈ 1.9:1 contrast. | WCAG 1.4.11 Non-text contrast (3:1 for component boundaries) | M |
| X6 | Toggles sit before their label with the help text indented underneath: long settings pages become a zig-zag that is hard to scan; toggles are also mixed with "Save" buttons in the same form (group editor). | NN/g toggle guidelines: immediate effect, label first, never mixed with submit | M |
| X7 | Sticky bars (editor actions, mobile bottom navigation) can cover the focused field. | WCAG 2.4.11 Focus not obscured | M |

### 2.2 Popup (the most used surface)

| # | Finding | Sev |
| --- | --- | --- |
| P1 | No status headline: the host, a dot with the group, a thin progress bar and a sentence. "Allowed; then Wait · 5:05 PM. · then Wait" repeats the next step twice (bug). | H |
| P2 | "Start focus" is the dominant element even on a site that is limited, so the eye goes to the least contextual action. | M |
| P3 | Action labels are truncated with an ellipsis ("Block…", "Break…") and the break cost appears alone on the next line ("no cost") without saying what it refers to. | M |
| P4 | "Open the dashboard" appears twice (gear icon and footer link); "Today: 1 s on limited sites." is a sentence for a single number. | L |

### 2.3 Dashboard

| # | Finding | Sev |
| --- | --- | --- |
| D1 | Today opens with a greeting ("Good afternoon") in the most valuable spot; the protection level is a small line; the "not active in private windows" notice is shown as a banner to every user who has not enabled it (banner blindness: a setup step, not an alert). | H |
| D2 | "Right now" lists groups with right-aligned grey text: no state colour, no icon, no remaining-time emphasis. Four tiles show "0" (zeros are noise), "Coming up" is a single line inside a full-width card. | M |
| D3 | Every group card shows six actions (up, down, edit, duplicate, share, archive), repeated for each group: visual noise and accidental clicks; the card itself is not clickable. The protection tag repeats the global level on every card. | M |
| D4 | The group editor hides its content behind five tabs numbered ①–④ like a wizard, but it is not a sequence: users cannot see sites and rules together, and validation issues in other tabs are invisible. The first tab starts with name, note, colour and icon in a large card before the sites. | H |
| D5 | Opening a rule shows a long form: three chip rows, selects with duplicated help ("per day" next to "per day"), the label "What happens" twice (bug). The intervention, the key decision of the product (G1, graduated friction), is a plain `<select>` that hides the scale. | H |
| D6 | "Shared lists" and "Always allowed" are ghost buttons in the search toolbar of Groups: concepts of the same level as groups look like filters. | M |
| D7 | Protection is a single long page: four level cards full of bullet points, then numeric settings labelled "(Strict)", "(Balanced)" shown whatever the level. | M |
| D8 | Sidebar has eight items with equal weight; "Later" sits among the primary destinations; the sidebar shows no status (level, active session, pending changes beyond a badge). | L |
| D9 | Insights: five tiles of which several are often zero, a bar chart without axis labels, single colour. | L |

### 2.4 Intervention page

| # | Finding | Sev |
| --- | --- | --- |
| I1 | Generally right (calm, note quoted, "Close the tab" first, G3). But on intention and wait pages the form card and the primary action are two disconnected blocks, and "Continue" is a disabled ghost button far from the healthy choice: the decision is not presented as one choice between two options. | M |
| I2 | "Instead, you could" items look like buttons but are static tags when they have no URL. | L |
| I3 | The logo is the main visual element on every page; the wait shows a number without progress. | L |

## 3. Research

### 3.1 Digital self-control research

- **Friction works, and keeps working.** A short delay before opening a target app (the one sec
  app) cut social media openings by 57 % in a field study (Grüning, Riedel & Lorenz-Spreen, *PNAS*
  2023). A 13-week in-the-wild study with 1,039 users found that short frictions keep reducing
  attempts over time and make openings more intentional; users take breaks from the tool and
  rebound quickly when they come back (Haliburton et al., *CHI* 2024). → The friction ladder (G1)
  is the core of the product and must be *visible* in the interface, and breaks must be easy to see
  and end.
- **Strictness has a cost.** Restrictive lockouts are more effective than warnings but cause more
  frustration because usage contexts differ (Kim et al., *GoalKeeper*, IMWUT 2019). → Show the
  strength of each rule explicitly, keep the strictest options a conscious choice (Locked preview,
  previews before uninterruptible sessions), always show the way out and its cost.
- **Dual-systems framing.** A review of 367 tools maps features to the reflective and impulsive
  systems: most tools block, few support goal setting and self-monitoring (Lyngs et al., *CHI*
  2019). Goal reminders help but can annoy; flexible, user-defined blocking is wanted (Lyngs et
  al., *CHI* 2020). → The personal note ("Why does this group exist?") is first-class in the editor
  header and on the intervention page; reminders stay opt-in.
- **Sense of agency.** People with a specific intention prefer interfaces that support agency
  (Lukoff et al., *CHI* 2021). → The intention question offers the user's own words first, the
  healthy choice and "continue" are presented side by side as an explicit choice, never as a trick.
- **Transparent nudges.** Technology-mediated nudges fail or become manipulative when they are not
  transparent (Caraban et al., *23 Ways to Nudge*, *CHI* 2019). → "Why?" is reachable from every
  status in at most two interactions (USAB-02); costs are shown before they are paid.

### 3.2 Interaction design guidelines

- **Visibility of system status** (Nielsen #1) and **preattentive processing** for dashboards
  (NN/g): status must be readable before reading — colour, icon and position, always with words
  (WCAG 1.4.1).
- **Calm technology** (Weiser & Brown 1995; Case 2015): inform without demanding attention; move
  from the periphery to the centre only when needed. → Quiet chrome (a dimmed sidebar, as in
  Linear's 2024–2026 redesigns), colour reserved for state, no alarm red outside destructive actions.
- **Progressive disclosure** (NN/g): show what is frequently needed, at most two levels. → One
  scrolling editor with sections and an "Advanced" disclosure instead of five tabs.
- **Tabs** (NN/g): only when users do not need to compare content across tabs; never mix in-page
  tabs with navigation. → Group editor sections are on one page; settings use navigation links.
- **Cards** (NN/g): make the whole card clickable; prefer lists for homogeneous items. → Group rows
  are clickable list cards; secondary actions move to an overflow menu.
- **Toggles** (NN/g): immediate effect, label first, never mixed with a Save button. → Settings rows
  with the label on the left and the switch on the right; the "On" switch of a group in the editor
  saves immediately like everywhere else.
- **Segmented controls** (Apple HIG: up to ~5 segments on phones; Material 3: 2–5 options) for
  short exclusive choices (durations, periods, theme, filters); chips stay for multi-select.
- **WCAG 2.2 AA**: target size (2.5.8), focus not obscured (2.4.11), dragging alternatives (2.5.7,
  the week grid and the group order already have button alternatives), non-text contrast (1.4.11).

### 3.3 Competitive and cross-domain analysis

| Product | What it does well | What we take |
| --- | --- | --- |
| one sec | One clear, calm screen at the moment of impulse; breathing animation as friction | Breathing progress ring on the wait; one decision per screen |
| ScreenZen | Wait that grows with every opening; "open anyway" always possible | Already in the engine (increasing delay); make the "continue" path honest and visible |
| Opal | Session-first home, strong status hero, "Deep Focus" as an explicit strongest level | Status hero in the popup and on Today; uninterruptible sessions previewed |
| Freedom | Blocklists + sessions, simple mental model | Groups as the main object, focus session always one tap away |
| Apple Screen Time | Clear "time left" language; criticised for one-tap "Ignore limit" | Remaining time as the headline; costs are never one silent tap |
| Android Digital Wellbeing | Paused apps greyed out, timers in the recents view, grayscale wind-down | Status shown where the user is (popup, badge, overlay); "paused" as a calm state |
| Cold Turkey | Strict locks praised, but lock-outs and opaque states frustrate | Always show why and until when; emergency exit visible |
| Apple Home / Shortcuts | Automations as "When … → Do …" sentences | Rules as sentence cards: **When** / **Limit** / **Then** |
| Linear | Dimmed navigation, density without noise, LCH-balanced palette | Quiet sidebar, flat cards, perceptually balanced tones |
| iOS / Android settings | Label left, control right, grouped lists | Settings rows |
| Car dashboard | Telltale lights: one icon + colour per state; the handbrake symbol | The brand's brake symbol (P) marks the "protected" state |

## 4. Design principles

1. **Status first.** Every surface starts with what is happening now: a tone (colour + icon + word)
   and, when relevant, the remaining time or the end time.
2. **One visual language for the friction ladder.** Each intervention has a fixed icon and one of
   five tones, used identically in the popup, Today, group rows, rule cards, "Why?" and the
   intervention page.
3. **Healthy choice first, honest choice always** (G3, G7). The healthy action is primary; the
   alternative is visible, labelled and costed.
4. **Quiet by default** (calm technology). Neutral chrome; colour only for state and for the
   primary action; red only for destructive actions.
5. **Everything about a group on one page**, with progressive disclosure for advanced options.
6. **Direct manipulation, fewer controls.** Whole rows clickable, rare actions in menus, short
   exclusive choices as segmented controls.
7. **Accessible by construction.** Tones always come with text and icon, contrast ≥ 4.5:1 for text
   and ≥ 3:1 for component boundaries, 24 px minimum targets (44 px on touch), focus never hidden.

## 5. Visual language

### 5.1 Tones

| Tone | Meaning | Interventions / states | Icon |
| --- | --- | --- | --- |
| `free` | Nothing stands in the way | allow, track (time is only counted) | check / chart |
| `gentle` | A light touch while browsing | remind, filter | bell / droplet |
| `friction` | A pause before entering | ask, delay, challenge | chat / hourglass / keyboard |
| `protected` | The space is protected | block, close, redirect, focus session | brake (P), x, arrow |
| `calm` | A break or a pass in progress | pause, pass | pause |
| `neutral` | No rules here, not applicable | — | globe |

A four-notch **friction meter** (free → gentle → friction → protected) accompanies the tone in
the popup and in the rule picker: the handbrake metaphor of the product name, made visible.

### 5.2 Tokens and components

- Neutral, slightly warm palette; tones defined for light, dark and high contrast; input borders at
  ≥ 3:1; cards flat (border only), shadows only for overlays (dialogs, menus, toasts).
- Type scale 12 / 13 / 15 / 17 / 20 / 26 px, tabular numbers for times.
- Buttons with 10 px radius (actions), pills only for chips and status (choices and labels), so
  the three families are distinguishable.
- New components: `Segmented`, `StatusPill`, `ToneIcon`, `FrictionMeter`, `Menu` (overflow,
  keyboard accessible), `FrictionPicker`, `SettingRow` (toggle layout), `Kpi`.

## 6. Surfaces

### 6.1 Popup

```
┌──────────────────────────────────────────┐
│ (P) WebHandbrake             ⛨ Balanced ⚙ │
├──────────────────────────────────────────┤
│ ┌ tone: free ───────────────────────────┐ │
│ │ ✓  video.test               ▮▮▯▯      │ │
│ │    44 min left today                  │ │
│ │    ████░░░░░░░░  1 of 45 min          │ │
│ │    Then: ⏳ Wait 20 s · ● Video        │ │
│ │    Why?                Stop for today │ │
│ └───────────────────────────────────────┘ │
│ [⏸ Take a break] [🔖 Later] [⛔ Block…]   │
│   no cost                                 │
├──────────────────────────────────────────┤
│ ◎ Focus session                           │
│ [ 25 min | 50 min | 90 min ]              │
│ [          ▶ Start focus             ]    │
├──────────────────────────────────────────┤
│ Today 1 h 12 min · 9 times you held back  │
│                              Dashboard →  │
└──────────────────────────────────────────┘
```

- The hero is tinted by tone; its headline is the most useful fact (time left, end time, "No
  rules here", "On a break until…").
- Quick actions are tiles with an icon and a full label; the break cost is shown inside the tile.
- "Block this site" opens an inline panel with the four granularities as radio rows that preview
  the resulting entry (`video.test`, `video.test/watch`…), then the group.
- During a focus session the focus row becomes the session status with time left, +15 min and End.

### 6.2 Dashboard shell

Quiet sidebar with two groups (Today, Groups, Focus, Insights · Later, Protection, Settings, Help)
and a status footer (protection level, pending changes, active session). Mobile keeps the bottom
navigation of §8.3.

### 6.3 Today

Date overline and title, a one-line status sentence and the protection chip; real warnings as
banners, setup steps (private windows) as a quiet "Finish setting up" card. Two columns: **Right
now** (group rows with tone pill, remaining-time bar, end time) and **Coming up** (timeline) on the
left; **Focus** and **Today's numbers** (one card, zeros shown quietly) on the right.

### 6.4 Groups

Sub-navigation **Groups · Shared lists · Always allowed** (navigation links, not tabs). Toolbar
with search and a segmented filter. Each group is a clickable row: icon tile in the group colour,
name, sites preview, rule summary, status pill, switch and an overflow menu (move up/down,
duplicate, share, archive). Drag and drop is kept with the menu as the accessible alternative.

### 6.5 Group editor

One page: an identity header (icon tile, name, "why" note, colour and icon), a sticky section nav
(Sites · Rules · Breaks · Block page · Protection · Advanced), the sections as cards, a sticky
side panel (In brief with tone pills, issues, Test a URL) and the sticky save bar.

Rules are sentence cards: `1  Mon–Fri 9:00–10:00  →  ⛔ Block`. Expanded, a rule has three blocks:
**When** (segmented: Always / During / Outside + windows), **Limit** (segmented: none / time /
visits / continuous use) and **Then**, the **friction picker**: every intervention as an option
ordered from gentlest to strongest, with its icon and tone, the description of the selected one and
its specific options below.

### 6.6 Intervention page

A centred column: tone emblem (brake symbol, or a breathing progress ring for waits), headline,
the user's note as a quote in the group colour, meta line with "Why?". For waits, intention
questions and challenges the step and the choice are one card: the step (question, chips, duration,
countdown) followed by **Close the tab** (primary) and **Continue…** (secondary, with the
remaining seconds in its label). "Go back", "Save for later", alternatives and the break link with
its cost follow.

### 6.7 Protection, Focus, Insights, Settings

- **Protection**: level picker as four compact radio cards with the details of the selected level;
  the numbers of each level in a "Fine-tune" disclosure; checklist with a score; access, emergency
  exit and events as sections.
- **Focus**: an active session is a hero with a progress ring and extend/end; the setup uses a
  segmented duration, two radio cards for the mode, group chips with colours and a "Start" select.
- **Insights**: segmented period, one KPI card with comparison, chart with day labels.
- **Settings**: navigation links instead of ARIA tabs (they change the route), setting rows.

## 7. Accessibility checklist

- Tones never alone: every pill and hero has an icon and a text; charts keep the table view.
- Contrast: text ≥ 4.5:1 in every theme; input and switch boundaries ≥ 3:1; focus ring 2 px.
- Keyboard: segmented controls and radio cards use roving tab index with arrow keys; the overflow
  menu supports arrows, Home/End, Escape and returns focus; dialogs keep focus trapped and restored.
- Sticky bars reserve scroll padding (`scroll-padding-bottom`) so focused fields are not covered.
- Reduced motion: the breathing ring and transitions stop.

## 8. Validation plan

Usability test (USAB-01…03, five participants per platform) with these tasks:

1. "Is YouTube limited right now? How much time is left?" (popup, ≤ 5 s)
2. "Make YouTube ask what you want to do instead of blocking it." (editor, friction picker)
3. "Block news sites on weekdays from 9 to 12." (new rule with the wizard)
4. "Take a 10-minute break from Social." (popup / intervention page)
5. "Why is reddit.com blocked?" (≤ 2 interactions)

Success criteria: task completion ≥ 90 %, SUS ≥ 80, no participant confusing the healthy choice
with "continue".

## 9. Implementation notes

| Piece | Where |
| --- | --- |
| Tokens, tones, components, layouts | `src/ui/styles/index.css` |
| Tone/icon mapping, status sentences | `src/ui/status.ts` |
| `Segmented`, `RadioCards`, `StatusPill`, `ToneIcon`, `GroupTile`, `FrictionMeter`, `Ring`, `Menu`, setting-row `Toggle` | `src/ui/components.tsx` |
| Popup | `src/popup/index.tsx` |
| Today, Groups (+ sub-navigation), group editor, Focus, Protection, Insights, Settings | `src/dashboard/pages/*` |
| Rule cards and friction picker | `src/dashboard/components/policy.tsx` |
| Intervention page | `src/intervention/index.tsx` |

Verification: unit tests, Chromium end-to-end tests (updated for the one-page editor and the
segmented popup), axe WCAG 2.2 AA checks in light and dark themes, extended to the open rule
editor, the open overflow menu and the popup's "Block this site" panel, and the Firefox smoke test.

Not done yet: the in-page overlay (content script) keeps its own palette; per-section validation
markers in the editor's section nav; a usability test with participants (§8).

## 10. Iteration 2: naming and the creation flow

Two changes were evaluated after the first redesign: a clearer name than "Groups", and a guided
way to create one.

### 10.1 The name of the main object

"Group" says nothing about what the object does (Nielsen #2: speak the users' language; NN/g on
information scent: specific labels, no generic ones). The object is a set of sites **plus** when
and how they are slowed down — from only counting time to a block.

Criteria: information scent (C1), accuracy for every configuration (C2), no clash with other
words of the interface (C3), familiarity from similar products — Jakob's law (C4), fit with the
graduated-friction principle G1 (C5).

| Name | C1 | C2 | C3 | C4 | C5 | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Groups | 2 | 5 | 5 | 2 | 3 | Accurate but meaningless on its own |
| Blocks | 5 | 2 | 1 | 5 | 1 | Cold Turkey "Blocks", Opal "Blocks" tab; wrong for rules that ask, wait or only count; clashes with the "Block" intervention ("Block → Block"); frames every rule as a wall |
| Limits | 4 | 4 | 1 | 4 | 4 | Screen Time "App Limits"; clashes with time limits, used everywhere (budgets, help, privacy, protection) |
| Rules | 4 | 5 | 4 | 3 | 5 | Jomo "Rules" tab, e-mail rules; matches the existing copy ("your rules", protection levels); needs the inner lines renamed |
| Brakes | 2 | 5 | 5 | 1 | 5 | On brand, but a metaphor: weak scent |

**Decision: "Rules"** (Italian "Regole"). The lines inside a rule ("Mon–Fri 9–17 → Block") become
**conditions**, and the browser's technical rules in Diagnostics become **browser filters**, so the
word is never used for two things.

The vocabulary problem (Furnas et al., 1987: two people choose the same word for an object less
than 20 % of the time) means no single label fits everyone. So the words users actually use stay
in the places where they look for them: the page subtitle "Block, limit or slow down the sites you
choose", the popup action "Block site", the wizard option "Block", and search over names and sites.

Mapping for contributors: UI *rule* = engine `Group`; UI *condition* = engine `Policy`. Code,
routes (`#/groups`) and stored data are unchanged.

### 10.2 Creating a rule step by step

The one-page editor (§6.5) suits *editing*. *Creating* is different: it is infrequent and done by
people who do not know the concepts yet, which is where NN/g recommends a wizard, and NN/g advises
against wizards for frequent expert tasks. Other products agree: Screen Time "Add Limit" (choose
apps → set time → Add), Jomo (choose a rule type → configure → confirm), Opal ("+" in Blocks).

New rule = a four-step wizard. Opening the full editor stays possible at any step:

```
 1 Sites ─── 2 When ─── 3 What happens ─── 4 Review
```

1. **Which sites?** Name (filled in from the list you pick or the first site), ready-made lists as
   chips (they add their sites, name, colour and icon), your own sites (paste anything).
2. **When should it apply?** Every time · At certain times (week windows with presets) · After
   some time each day (15 min … 2 h).
3. **What should happen?** Every intervention, from the gentlest to the strongest, in the tones of
   §5.1: Count only · Reminder · Filter · Ask first · Wait · Challenge · Block · Close tab ·
   Redirect. Nothing is pre-selected (changed in iteration 3, §11.2); a redirect asks for its
   address, every other setting starts from a default that the editor can refine.
4. **Check and create.** The plan as one sentence ("After 30 min a day on facebook.com and 16 more
   sites, WebHandbrake first asks what you want to do."), name, optional personal reason, colour
   and icon, and the defaults (break cost, protection level). "Create rule" or "Customise all
   options first".

Why this structure:

- **Implementation intentions.** The steps build an if-then plan ("when situation X, then I do
  Y"), and the review sentence states it; forming such plans has a medium-to-large effect on goal
  attainment (Gollwitzer & Sheeran 2006, d = 0.65 over 94 tests).
- **Defaults matter** (Johnson & Goldstein 2003), which is why the first version pre-selected the
  gentle option. Iteration 3 replaced this with an active choice (§11.2): the right intervention
  depends on the person and the sites. Friction stays the gentle middle of the scale and is
  described as such (Grüning et al. 2023, Haliburton et al. 2024; Kim et al. 2019 on lockouts;
  Bryan, Karlan & Nelson 2010 on soft commitments).
- **A personal reason** at the end (optional): goal reminders keep people on task (Lyngs et al.
  2020) and are shown on the page that stops you.
- **NN/g wizard guidelines.** Few steps (4), visible progress with step names, descriptive buttons
  ("Next: when"), self-contained steps, back allowed and completed steps reachable, state kept for
  the session ("You are continuing the rule you started earlier · Start over"). Fields entered once
  are pre-filled later (WCAG 3.3.7 Redundant entry). Focus moves to each step's heading
  (A11Y-02).
- **Progressive disclosure** (NN/g, at most two levels). Exceptions, several conditions, break
  rules, the block page and per-rule protection are left to the editor. The review says so.

Where: `src/dashboard/pages/group-wizard.tsx`, `quickPolicies()` in `src/engine/defaults.ts` (also
used by onboarding), tests in `tests/e2e/ui.spec.ts`, `tests/e2e/a11y.spec.ts` (every step) and
`tests/unit/quick-rules.test.ts`.

## 11. Iteration 3: first run, identity and details

Feedback on the first run and on everyday use led to a third round. Each change below was checked
against the same sources as before; new ones are in §12.

### 11.1 First run

```
 Welcome ── ✓ Installed ── 1 Your goal ── 2 Sites ── 3 Details* ── 4 Your plan ── You're set
                                                    (* hours, daily time or what happens)
```

- **Welcome.** The value in three points (gentle, firm when needed, private) and two buttons of
  the same size: **Set up in about a minute** (primary) and **Skip setup** (secondary). A skip
  link was too easy to miss; a secondary button keeps the hierarchy (one primary action per view)
  while making the way out equally visible (NN/g on onboarding: always allow skipping; Material 3:
  outlined buttons for the alternative to the main action).
- **Endowed progress.** "Installed" is shown as an already completed step (Nunes & Drèze 2006:
  people are more likely to finish a task that is visibly under way; Kivetz, Urminsky & Zheng 2006:
  effort increases near the goal). Only the steps of the chosen goal are counted: 3 or 4.
- **Your goal.** Five outcomes in the user's words ("Stop opening sites out of habit", "Spend less
  time on some sites", "Stay focused at certain hours", "Block some sites completely", "Just see
  where my time goes"). None is pre-selected and none is marked as recommended (§11.2).
- **Sites.** The ready-made lists as tiles, **your own sites always visible** (no disclosure: it
  is one of the two ways to answer the question, not an advanced option) with the short guide of
  §11.7, and a live **selection summary**: one line per rule that will be created with its number
  of sites, then the total ("3 rules · 38 sites in total"). Addresses of sensitive lists are not
  shown (§11.4).
- **Details.** Hours (week windows) for a schedule, minutes a day for a limit, and what happens:
  **all nine interventions** (§11.2), with a miniature of what each looks like on a site (show,
  don't tell). "Block" and "Just see" imply the intervention, so they skip this step.
- **Your plan.** The if-then sentence of §10.2, the rules that will be created, the optional
  personal reason, and how firm the protection should be. The current level starts selected: it
  is the state of the extension, not a recommendation. The site-access permission is asked here,
  in context, only when missing (permission priming).
- **You're set.** Next steps that cannot be done by the page itself: pin the button (Chrome hides
  extensions behind the puzzle menu), try a site, allow private windows when needed.
- "Run the setup again" was removed from Help: rules are created with **New rule** (§10.2), and a
  second first run would only duplicate rules.

### 11.2 Active choice instead of recommendations

We do not know why someone installed the extension, so the first run and the rule wizard no
longer pre-select or label anything as "Recommended" where the answer depends on the person (goal,
what happens). The next step opens once a choice is made.

- Defaults work when most people share the same best option; when preferences are heterogeneous,
  an **active decision** gives better outcomes than any default (Carroll, Choi, Laibson, Madrian &
  Metrick 2009). Requiring a choice also raises follow-through compared with an opt-out default
  (Keller, Harlam, Loewenstein & Volpp 2011, *enhanced active choice*).
- Choosing one's own goal and response supports autonomy, which predicts lasting self-regulation
  (Ryan & Deci 2000), and it is the plan of an implementation intention (Gollwitzer & Sheeran
  2006).
- Defaults remain where they help: the settings of the chosen intervention (30 s wait, grayscale
  filter, 24-character challenge…), stated as "Its settings use sensible defaults; you can
  fine-tune them later in the rule." Only the redirect address has no sensible default and is
  asked for.
- All nine interventions are offered in the order of the friction ladder (gentler → stronger),
  in a 3 × 3 grid with the tones of §5.1, and the description of the chosen one below. "Count
  only" is available with "Every time" only (a schedule or a limit that only counts makes no
  sense).

### 11.3 Colour and identity

Every trace of the product that inspired the first version was removed (importer, requirement
references, comments, comparisons); lists of sites are still imported in generic formats (plain
lists, hosts files, uBlock Origin / AdGuard, uBlacklist).

The default accent and brand colour is a muted **indigo `#4850a5`** (dark theme `#a6b2f4`):

- Purple-blue is among the most pleasant and least arousing hues (Valdez & Mehrabian 1994): the
  extension should calm, not alarm. Red is avoided for the brand, since in achievement contexts it
  signals threat and avoidance (Elliot & Maier 2014); red-like tones stay for warnings.
- Blue is associated with competence and trust (Labrecque & Milne 2012), fitting a tool people
  hand control to; colour–emotion associations are largely shared across countries (Jonauskaite
  et al. 2020), which matters for a translated product.
- It is distinct from the green/teal used before and from the state tones (green allowed, teal
  gentle, amber friction, plum protected), so the brand never reads as a state.
- Text on the accent and the accent on the background pass WCAG AA in light, dark and high
  contrast; the old default is migrated automatically when it was never changed.

### 11.4 Sensitive lists

The extension may be used by minors and on shared screens, so the addresses of the gambling and
adult lists are never shown unless asked: the onboarding tiles show "19 sites · not shown", rule
rows and plan sentences count them without naming them, and the sites editor collapses them into
one row ("19 addresses from sensitive lists are hidden · Show"). The addresses are not needed to
decide; showing them on request keeps the list reviewable.

### 11.5 "Allowed" instead of "Free"

"Free" was ambiguous (free of charge, free time, free of rules?) and the extension itself is
described as free software. Following the vocabulary problem (Furnas et al. 1987) and Jakob's law,
states now use the pair people know from Screen Time ("Always Allowed"), Family Link and Microsoft
Family Safety: **Allowed / Blocked**. "Allowed until 17:00", "Allowed · Reminder"; a rule that only
counts shows **Time counted**.

### 11.6 Ready-made lists cover whole platforms

Lists target a platform, not a country domain: `amazon.*` matches amazon.com, amazon.it,
amazon.co.uk…, subdomains are always included (m.youtube.com), and alternative domains of the same
service are listed (youtu.be, fb.com). The lists live in `src/data/templates.ts` for review.

### 11.7 Writing addresses: the short guide

Next to every sites input, a collapsed **"How to write an address"** guide lists what people want
to do, each with an example: a whole site, the site in every country (`amazon.*`), one subdomain,
only the exact address (`=`), a section, a single page (`$`), only the home page, any text (`*`),
an exception (`+`), and pasting lists. The full syntax stays in Help.

- Help should be concise, task-oriented and list concrete steps (Nielsen #10); minimalist
  instruction starts from real tasks (Carroll 1990); worked examples teach faster than rules
  (Sweller & Cooper 1985).
- Picking an example puts it in the input, selected, ready to be edited (recognition rather than
  recall, Nielsen #6).
- A sentence pasted by mistake is reported once ("Line 1 'not a site': not a site address…"),
  not once per word; among real sites, each wrong entry is still reported on its own.

### 11.8 Popup: the way to the dashboard

The gear icon was ambiguous (a gear means settings) and small. The header now has a labelled,
tinted **Dashboard** button at the top right, where people look for "open the app" (NN/g on icon
usability: labels for all but universal icons; Material 3 tonal buttons for important secondary
actions). To make room, the product name became a screen-reader label next to the logo. The
footer link under today's time now opens **Details** (Insights), matching what it sits under.

### 11.9 Source code and issues

Help → **About** links to the source code and to "Report a problem or suggest an idea" (GitHub
issue chooser); Diagnostics adds "Open an issue on GitHub" next to "Copy diagnostic report". They
are plain links opened by the user; the extension itself still makes no network requests
(PRIV-01). The manifest's homepage points to the repository too.

Verification: unit tests (list parsing, first-run classification), Chromium end-to-end tests of
the first run (active choices, hidden addresses, selection summary, custom sites) and of the
wizard (nine options, redirect address), axe WCAG 2.2 AA checks on every first-run and wizard
step, 390 px layout checks, screenshots in light and dark themes, and the Firefox smoke test.

## 12. References

- Bryan, G., Karlan, D., Nelson, S. (2010). *Commitment Devices.* Annual Review of Economics 2.
- Carroll, G. D., Choi, J. J., Laibson, D., Madrian, B. C., Metrick, A. (2009). *Optimal Defaults
  and Active Decisions.* Quarterly Journal of Economics 124(4).
- Carroll, J. M. (1990). *The Nurnberg Funnel: Designing Minimalist Instruction for Practical
  Computer Skill.* MIT Press.
- Elliot, A. J., Maier, M. A. (2014). *Color Psychology: Effects of Perceiving Color on
  Psychological Functioning in Humans.* Annual Review of Psychology 65.
- Jonauskaite, D., et al. (2020). *Universal Patterns in Color-Emotion Associations Are Further
  Shaped by Linguistic and Geographic Proximity.* Psychological Science 31(10).
- Keller, P. A., Harlam, B., Loewenstein, G., Volpp, K. G. (2011). *Enhanced active choice: A new
  method to motivate behavior change.* Journal of Consumer Psychology 21(4).
- Kivetz, R., Urminsky, O., Zheng, Y. (2006). *The Goal-Gradient Hypothesis Resurrected.* Journal
  of Marketing Research 43(1).
- Labrecque, L. I., Milne, G. R. (2012). *Exciting red and competent blue: the importance of color
  in marketing.* Journal of the Academy of Marketing Science 40(5).
- Nunes, J. C., Drèze, X. (2006). *The Endowed Progress Effect.* Journal of Consumer Research
  32(4).
- Ryan, R. M., Deci, E. L. (2000). *Self-Determination Theory and the Facilitation of Intrinsic
  Motivation, Social Development, and Well-Being.* American Psychologist 55(1).
- Sweller, J., Cooper, G. A. (1985). *The Use of Worked Examples as a Substitute for Problem
  Solving in Learning Algebra.* Cognition and Instruction 2(1).
- Valdez, P., Mehrabian, A. (1994). *Effects of Color on Emotions.* Journal of Experimental
  Psychology: General 123(4).
- NN/g: *Mobile-App Onboarding*; *Icon Usability*; *Help and Documentation* (heuristic #10).
  Google. *Material Design 3 — Buttons* (filled tonal, outlined).
- Furnas, G. W., Landauer, T. K., Gomez, L. M., Dumais, S. T. (1987). *The vocabulary problem in
  human-system communication.* Communications of the ACM 30(11).
- Gollwitzer, P. M., Sheeran, P. (2006). *Implementation intentions and goal achievement: a
  meta-analysis of effects and processes.* Advances in Experimental Social Psychology 38.
- Johnson, E. J., Goldstein, D. (2003). *Do defaults save lives?* Science 302(5649).
- NN/g: *Wizards: Definition and Design Recommendations*; *Match Between the System and the Real
  World*; *Information Scent*.
- Caraban, A., Karapanos, E., Gonçalves, D., Campos, P. (2019). *23 Ways to Nudge: A Review of
  Technology-Mediated Nudging in Human-Computer Interaction.* CHI '19.
- Case, A. (2015). *Calm Technology: Principles and Patterns for Non-Intrusive Design.* O'Reilly.
- Grüning, D. J., Riedel, F., Lorenz-Spreen, P. (2023). *Directing smartphone use through the
  self-nudge app one sec.* PNAS 120(8).
- Haliburton, L., Grüning, D. J., Riedel, F., Schmidt, A., Terzimehić, N. (2024). *A Longitudinal
  In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse.* CHI '24.
- Kim, J., Jung, H., Ko, M., Lee, U. (2019). *GoalKeeper: Exploring Interaction Lockout Mechanisms
  for Regulating Smartphone Use.* IMWUT 3(1).
- Lukoff, K., Lyngs, U., Zade, H., et al. (2021). *How the Design of YouTube Influences User Sense
  of Agency.* CHI '21.
- Lyngs, U., Lukoff, K., Slovak, P., et al. (2019). *Self-Control in Cyberspace: Applying Dual
  Systems Theory to a Review of Digital Self-Control Tools.* CHI '19.
- Lyngs, U., Lukoff, K., Slovak, P., et al. (2020). *"I Just Want to Hack Myself to Not Get
  Distracted": Evaluating Design Interventions for Self-Control on Facebook.* CHI '20.
- Nielsen, J. (1994, updated 2020). *10 Usability Heuristics for User Interface Design.* NN/g.
- NN/g articles: *Progressive Disclosure*; *Tabs, Used Right*; *Cards: UI-Component Definition*;
  *Toggle-Switch Guidelines*; *Indicators, Validations, and Notifications*; *Dashboards: Making
  Charts and Graphs Easier to Understand* (preattentive processing).
- Weiser, M., Brown, J. S. (1995). *Designing Calm Technology.* Xerox PARC.
- W3C (2023). *Web Content Accessibility Guidelines (WCAG) 2.2.*
- Apple. *Human Interface Guidelines — Segmented controls.* Google. *Material Design 3 — Segmented
  buttons.*
- Linear (2024, 2026). *How we redesigned the Linear UI*; *Behind the latest design refresh.*
