# Roadmap

What could come next, and what has to be verified. The [requirements](requirements.md) state what
exists; this page holds the rest.

## How to read this

Nothing on this page exists in the product. The items are candidates, not commitments: the
maintainer decides which are built, and in which order. Each candidate states the problem it
addresses, the evidence (with the study design in a few words), the expected effect and its main
risk or cost, and the requirement ID when one exists. A candidate that is accepted gets a
requirement before it is built.

## Before the first release

The store submissions and the checks that precede them are in the
[release checklist](releasing.md#release-checklist). Two gaps have to be closed first: the
packages do not carry Preact's licence notice ([ADR 0003](adr/0003-license.md)), and the
repository settings that the documents rely on (GitHub Discussions, private vulnerability
reporting and reported content) are not turned on. Publication itself is
[MAINT-03](requirements.md#maint-03); signed releases with a changelog are part of
[PRIV-07](requirements.md#priv-07).

## Verification debt

Some behaviour exists but has not been verified as its requirement asks. The
[traceability matrix](traceability.md#unverified-requirements) lists those requirements; the work
that would verify them is:

- **A usability test** with at least five people
  ([USAB-01](requirements.md#usab-01), [USAB-03](requirements.md#usab-03)). Tasks and targets:
  each person tells the status of a site within 5 seconds; finds **Why?** in at most two
  interactions; completes at least 90% of the tasks; the System Usability Scale score is 80 or more;
  and nobody mistakes the healthy choice on the intervention page for continuing.
- **Checks on a Firefox for Android device**: time counting, export and import, the interface by
  touch and the release smoke test ([TIM-04](requirements.md#tim-04),
  [DAT-05](requirements.md#dat-05), [COMP-03](requirements.md#comp-03),
  [REL-03](requirements.md#rel-03)).
- **Performance measurements**: background CPU at rest and with many open tabs, the time from a
  state change to the open tabs, memory use, behaviour with 10,000 entries, and the opening time of
  the popup and the dashboard ([PERF-01](requirements.md#perf-01),
  [PERF-02](requirements.md#perf-02), [PERF-03](requirements.md#perf-03),
  [PERF-05](requirements.md#perf-05), [PERF-06](requirements.md#perf-06)).
- **A manual accessibility evaluation** of every page and of the on-page overlay, with a screen
  reader and the keyboard ([A11Y-01](requirements.md#a11y-01), [A11Y-04](requirements.md#a11y-04)).
- **Manual checks** of session restore and pinned tabs, and of pages with `beforeunload` handlers
  ([ENF-05](requirements.md#enf-05), [ENF-07](requirements.md#enf-07)).
- **Smoke tests on the minimum browser versions** that the manifests declare
  ([ADR 0010](adr/0010-minimum-browser-versions.md)): the end-to-end suite runs on current
  releases only.

## Interface debt

- **The on-page overlay keeps its own colours.** It follows the system's light or dark scheme, but
  not the theme, high contrast or accent chosen in Settings, which the content script does not
  receive (`src/content/overlay.ts`). The [accessibility statement](accessibility.md) lists it.
- **No validation markers in the rule editor's section navigation.** Errors are counted in the
  save bar only, so the section that holds one is not marked.
- **No reduced-motion option inside the extension.** Animations stop only when the system asks
  for reduced motion.
- **The order of the interventions in the picker differs from their severity.** The picker lists
  Redirect after Close the tab (`LADDER` in `src/ui/status.ts`), while Redirect is as severe as
  Block and Close the tab is the most severe (`SEVERITY` in `src/engine/decide.ts`).

## Candidates

None of these is implemented. The maintainer decides.

- **Rotation of equivalent interventions** ([INT-11](requirements.md#int-11)).
  - Problem: an intervention that never changes loses its effect as people get used to it.
  - Evidence: in three field studies with HabitLab users, rotating interventions reduced the time
    spent on sites but made more people uninstall the tool, and a just-in-time explanation reduced
    that attrition by half ([Kovacs et al. 2018](principles.md#ref-kovacs2018)). Security
    warnings whose appearance changes resist habituation better than static ones
    ([Anderson et al. 2016](principles.md#ref-anderson2016)).
  - Expected effect: slower habituation. Opt-in, with the explanation shown when rotation starts.
  - Risk: more people uninstall; the explanation is necessary, not optional.
- **Visual friction that grows during a visit**, built from the existing filters and ordered
  conditions (a new requirement on acceptance).
  - Problem: a plain prompt loses its impact quickly.
  - Evidence: in a week-long randomised field study with 104 people on short-form video apps, a
    plain pop-up was effective at first but quickly lost impact, while a gradually intensifying
    visual intervention kept its subjective ratings longest; for highly impulsive people the
    explicit pop-up worked best ([Meinhardt et al. 2026](principles.md#ref-meinhardt2026)).
  - Expected effect: a longer-lasting effect for some people.
  - Risk: the explicit prompt must stay available; the evidence comes from phones and from
    subjective ratings.
- **A commitment phrase of the person's own as the suggested typed challenge** for interventions,
  with random codes kept for protection costs. A challenge can already ask for a phrase; this
  candidate makes it the suggestion.
  - Problem: random characters carry no meaning.
  - Evidence: in a ten-week within-subject field experiment with 54 people, typing a
    self-affirmation to unlock the phone reduced app use by over 50%, more than showing the
    affirmation alone or typing meaningless text ([Xu et al. 2022](principles.md#ref-xu2022)).
  - Expected effect: a larger reduction than random text, for a small change.
  - Risk: people may write weak phrases.
- **Guided if-then plans** linked to the alternatives, shown first on the intervention page, with a
  light prompt to rehearse them ([MOT-02](requirements.md#mot-02)).
  - Problem: alternatives are rarely planned in advance.
  - Evidence: a meta-analysis of 642 tests found benefits of implementation intentions with d from
    .27 to .66, larger for if-then wording, motivated people and rehearsed plans
    ([Sheeran et al. 2025](principles.md#ref-sheeran2025)); tools that redirect to another
    activity automate implementation intentions ([Lyngs et al. 2019](principles.md#ref-lyngs2019)).
  - Expected effect: modest gains for motivated people.
  - Risk: more steps at setup.
- **A weekly review on the device**: intent against use, the rules loosened since the last review,
  and tightening them again in one step ([STA-05](requirements.md#sta-05)).
  - Problem: people drift to easier settings while expecting to tighten them again.
  - Evidence: logs of more than 8,000 HabitLab users showed people slipping to easier interventions
    over time while expecting to strengthen them again soon after
    ([Kovacs et al. 2021](principles.md#ref-kovacs2021)).
  - Expected effect: counters the drift.
  - Risk: one more notification; it must stay optional.
- **A rest mode** that keeps the configuration, follows the protection rules (resting is a
  loosening) and makes coming back one step (a new requirement on acceptance).
  - Problem: people take breaks from friction tools, and uninstalling loses everything.
  - Evidence: logs of 1,039 one sec users over an average of 13.4 weeks showed people taking
    periodic breaks from the interventions and, on returning, quickly rebounding from a pattern of
    overuse ([Haliburton et al. 2024](principles.md#ref-haliburton2024)); design can support what
    happens after people stop using a self-tracking tool
    ([Epstein et al. 2016](principles.md#ref-epstein2016)).
  - Expected effect: coming back costs less than reinstalling.
  - Risk: it could become an easy way out, so it must cost what a loosening costs.
- **A focus or explore switch per site**, such as a search-only mode for a video site
  ([ELM-01](requirements.md#elm-01), [ELM-05](requirements.md#elm-05)).
  - Problem: recommendations and autoplay reduce the sense of agency.
  - Evidence: SwitchTube, a video interface that switches between a search-first focus mode and a
    recommendation-first explore mode, was studied with 46 people over three weeks
    ([Lukoff et al. 2023](principles.md#ref-lukoff2023)); autoplay and recommendations mainly
    undermined the sense of agency, while search and playlists supported it
    ([Lukoff et al. 2021](principles.md#ref-lukoff2021)).
  - Expected effect: more agency on sites that stay useful.
  - Risk: it needs element removal, which breaks when sites change their pages.
- **A way to pass typed and timed challenges without typing or waiting**, as an accessibility
  option (a new accessibility requirement on acceptance).
  - Problem: the effort of friction falls unevenly on people with motor or cognitive disabilities
    ([Schwartz & Monge Roffarello 2026](principles.md#ref-schwartz2026)).
  - Evidence: the same review, and WCAG 2.2 success criterion 2.2.1
    ([W3C 2023](principles.md#ref-w3c2023)).
  - Expected effect: friction that more people can use.
  - Risk: the alternative must stay as deliberate as the challenge it replaces.
- **`use_dynamic_url` for the intervention page on Chrome.**
  - Problem: any site can tell that WebHandbrake is installed
    ([threat model](threat-model.md#residual-risks)).
  - Evidence: extensions can be discovered through their web-accessible resources
    ([Sjösten et al. 2017](principles.md#ref-sjosten2017)).
  - Expected effect: sites can no longer detect the extension that way.
  - Risk: the redirects of the browser blocking filters must be shown to work with a dynamic
    address.
- **`webRequest` as an optional permission**, asked for with the clock check
  ([ADR 0009](adr/0009-permissions.md)).
  - Problem: broad permissions lengthen store review
    ([Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)).
  - Expected effect: fewer required permissions.
  - Risk: the clock check could no longer be on by default.
- **Detecting a change of time zone** ([SCH-06](requirements.md#sch-06)).
  - Problem: changing the time zone moves every schedule
    ([CIR-19](threat-model.md#cir-19)).
  - Expected effect: closes that route.
  - Risk: travelling must not be treated as tampering.
- **Deleting the automatic backups.**
  - Problem: the backups keep the whole configuration, the settings password hash included, and
    nothing deletes them except rotation and uninstalling; they survive Reset and the emergency
    exit ([threat model](threat-model.md#residual-risks)).
  - Expected effect: the person can remove every copy of their configuration.
  - Risk: it removes the safety net against damaged storage, so it needs a clear confirmation.
- **A notice inside the extension when data handling changes** (a new privacy requirement on
  acceptance).
  - Problem: the Chrome Web Store asks extensions to tell users proactively when data handling
    changes ([Chrome Web Store policy updates 2026](https://developer.chrome.com/blog/cws-policy-updates-2026)).
  - Expected effect: compliance for a release that changes data handling.
  - Cost: needed only for such a release.
- **Links from the popup, the intervention page and Protection to the right Help topic**, with
  addresses for each topic (a new first-run and help requirement on acceptance).
  - Problem: Help is reachable only from the dashboard.
  - Evidence: Nielsen's tenth heuristic, help and documentation where the task is
    ([Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/)).
  - Expected effect: faster answers in context.
  - Cost: a small change to the dashboard's router.
- **A release workflow started by a tag** that builds the packages and publishes their checksums,
  an SBOM and a provenance attestation ([SEC-06](requirements.md#sec-06)).
  - Problem: release files are made by hand.
  - Evidence: the build and release controls of the [OpenSSF OSPS Baseline](https://baseline.openssf.org/)
    and the [OpenSSF Scorecard](https://github.com/ossf/scorecard).
  - Expected effect: releases that anyone can verify.
  - Cost: one more workflow to maintain.
- **Normalised timestamps in the zip packages.**
  - Problem: the packages are not byte-identical between builds, only `dist/` is
    ([ADR 0011](adr/0011-auditable-build.md)).
  - Evidence: the [Reproducible Builds definition](https://reproducible-builds.org/docs/definition/).
  - Expected effect: byte-identical packages.
  - Cost: small.
- **Requirements already planned**, among them guided enterprise policies
  ([PRO-10](requirements.md#pro-10)), managed storage ([PRO-11](requirements.md#pro-11)), a partner
  code ([PRO-06](requirements.md#pro-06)), a password per rule ([PRO-16](requirements.md#pro-16))
  and translations ([I18N-03](requirements.md#i18n-03)).

## Planned requirements

The planned requirements, with their priorities, are listed once, in
[the requirements](requirements.md#planned-requirements).
