# Principles and evidence

This document explains why WebHandbrake works the way it does: its vision, the ten principles
G1–G10, the design decisions that follow from them with the research behind each, what that
research does not show, and the ethical limits the product keeps. It is written for contributors
and for anyone evaluating the product. The rules for the interface itself are in the
[design document](design.md); the normative behaviour is in the [requirements](requirements.md).

Code cites a principle as "principle G3" and a work as a link to its entry under
[References](#references).

## Vision

WebHandbrake applies the least friction that helps and the most respect it can: it slows down,
limits or blocks the sites a person chooses, when they choose, and nothing leaves their device.
A handbrake can be pulled lightly, more firmly or all the way; it is set in a calm moment and is
hard to release on an impulse.

## Principles

### G1 Graduated friction

The person chooses how strongly each rule steps in, on a ladder of interventions. The ladder runs
from **Only count time** through **Reminder**, **Filter**, **Ask what I want to do**, **Wait** and
**Challenge** to **Block**, **Redirect** and **Close the tab**. In first run and in the rule wizard
nothing on the ladder is pre-selected ([ADR 0008](adr/0008-active-choice.md)).

### G2 Asymmetry

Making rules stricter takes effect at once. Loosening them follows the protection level the person
chose: a confirmation (**Soft**), a wait (**Balanced**), a cooling-off period followed by a typed
confirmation and no loosening while the rule is active (**Strict**), or a refusal until a date
(**Locked**) ([ADR 0004](adr/0004-change-classification.md)).

### G3 The healthy choice is the easiest

Wherever WebHandbrake stops a page, the primary button leaves it (**Close the tab**, or
**Not now — close the tab** after a question). Where continuing is possible, it is visible and
labelled, but it is the secondary choice. The break dialog and the cost dialogs follow the same
order: **Not now** and **Keep my rules** are their primary buttons.

### G4 Precision

A rule targets exactly what distracts: a whole site, the site in every country (`name.*`), one
subdomain, one exact host, a section, a single page, the home page only, addresses with given query
parameters, wildcards or, in **Advanced mode**, regular expressions. Exceptions keep parts of a site
open, and a rule can also block a site's content embedded in other pages. WebHandbrake works on
addresses; it does not remove elements inside a page.

### G5 Reliable and explainable

Rules apply from browser start-up, through the browser's own blocking filters first and a second
check by WebHandbrake. **Why?** in the popup and on the intervention page, and **Test a URL** in the
rule editor, say which condition applies, why and until when.

### G6 Local-first and private

There is no account, no server and no telemetry. Rules, settings and statistics stay in the
browser's storage on the device; the extension makes no network requests of its own. Export and
deletion are in the person's hands.

### G7 Respect and autonomy

Wording is calm and never blames. The strictest options are chosen knowingly, after a preview of
their consequences. The emergency exit always works and needs nobody else, and uninstalling is
always possible.

### G8 Simple by default, powerful on demand

First run and the rule wizard ask only what a first rule needs. **Advanced mode** adds regular
expressions, rolling periods, per-site limits, text editing of lists and other expert options.

### G9 Sustainable

WebHandbrake does not nag: notifications are off until the person turns them on, and a reminder
appears once per visit. Varying interventions against habituation is a
[roadmap candidate](roadmap.md#candidates), not a feature.

### G10 Firefox for Android is a target

WebHandbrake supports Firefox for Android, with limits that the user guide states
([Firefox for Android](user-guide.md#firefox-for-android)). Checks on a real device are part of the
[verification debt](roadmap.md#verification-debt).

## Decisions and evidence

Each decision names the requirements that implement it, the evidence with its design and size, and
how far that evidence goes. The figures belong to the studies and to other tools, never to
WebHandbrake ([What the evidence does not show](#what-the-evidence-does-not-show)).

### Friction at the point of impulse, in graduated steps

- **Decision.** Offer a ladder of interventions, from counting time to closing the tab, and let the
  person pick the step for each condition, rather than offering only a wall.
- **Implemented by** INT-01, INT-02, INT-03, INT-04, INT-05, INT-06, INT-18, INT-19.
- **Evidence.**
  - The one sec app shows a pop-up with a deliberation message, a short wait and an option to
    dismiss. In a six-week field study of 280 users with no control group, users dismissed 36% of
    opening attempts, attempts fell by 37% and actual openings by 57%
    ([Grüning et al. 2023](#ref-gruning2023)). These figures describe the whole pop-up, not the
    wait alone.
  - Logs of 1,039 one sec users over an average of 13.4 weeks showed that attempts kept falling and
    openings became more intentional; users took periodic breaks from the interventions and, on
    returning, quickly rebounded from a pattern of overuse
    ([Haliburton et al. 2024](#ref-haliburton2024)).
  - In a four-week field experiment with 36 people, restrictive lockouts changed behaviour more than
    warnings but caused more frustration and pressure, because contexts of use vary
    ([Kim et al. 2019](#ref-kim2019)).
  - A systematic review and meta-analysis of digital self-control tools reports a small-to-medium
    effect on time spent on distracting sources, from few and short studies
    ([Monge Roffarello & De Russis 2023](#ref-mongeroffarello2023)).
  - Of 367 tools, blocking or removal was the most common approach, followed by self-tracking, goal
    advancement and reward or punishment; delay and habit scaffolding were among the least targeted
    mechanisms ([Lyngs et al. 2019](#ref-lyngs2019)).
- **Confidence.** Moderate that friction when a site is opened reduces use in the short term. Low
  on how long it lasts and on what each component contributes. The filter step has no checked
  evidence here.

### The way out is the primary action

- **Decision.** On the intervention page the primary button closes the tab; continuing is
  secondary, visible and labelled.
- **Implemented by** INT-01 and principle G3.
- **Evidence.** In a preregistered online experiment (N = 500) with real social media clips, the
  explicit option to dismiss was the most effective part of one sec, and the wait also helped
  ([Grüning et al. 2023](#ref-gruning2023)).
- **Confidence.** One experiment, run on a phone app's design; the transfer to browser pages is an
  assumption.

### Loosening waits, tightening is instant

- **Decision.** Changes that make rules stricter apply at once; changes that loosen them follow the
  protection level ([ADR 0004](adr/0004-change-classification.md)).
- **Implemented by** PRO-02, PRO-03.
- **Evidence.**
  - Precedent: the UK Gambling Commission requires that customer-led reductions of gambling limits
    apply at once, and that increases apply only on request, after a cooling-off period of at
    least 24 hours and a positive confirmation at its end
    ([Gambling Commission 2025](#ref-gamblingcommission2025)).
  - Logs of more than 8,000 HabitLab users showed that people start with hard interventions, slip
    to easier ones over time, and keep choosing to be asked again rather than settling on the easy
    ones ([Kovacs et al. 2021](#ref-kovacs2021)).
- **Confidence.** No study of self-control tools has tested this asymmetry. It is an inference from
  the precedent and from the drift towards easier settings.

### Strictness is chosen, with an emergency exit

- **Decision.** The person chooses the protection level, with a preview before the strictest
  options. Whatever the level, the emergency exit needs nobody else: after a long wait and a typed
  sentence it ends every focus session and sets every protection level to **Soft**, while the rules
  themselves stay.
- **Implemented by** PRO-01, PRO-15, ONB-07, ETH-02.
- **Evidence.**
  - In a one-week field study of 32 workers, blocking distractions raised self-rated focus and
    productivity, most for people who felt less in control of their work; people who felt more in
    control reported a higher workload, worked longer without physical breaks and were more
    stressed ([Mark et al. 2018](#ref-mark2018)).
  - Restrictive lockouts work better than warnings but frustrate ([Kim et al. 2019](#ref-kim2019)).
  - People misjudge the commitments they choose: in a field experiment with a commitment savings
    product, 55% of the clients defaulted and lost money, possibly because the penalties they chose
    were too weak ([John 2020](#ref-john2020)).
  - Precedent: password managers grant emergency access after a wait that the owner sets and can
    interrupt ([Bitwarden 2026](#ref-bitwarden2026)).
- **Confidence.** The individual differences come from one small, one-week study. The exit is a
  design judgement supported by evidence from other domains.

### Active choice in setup

- **Decision.** In first run and in the rule wizard, nothing that depends on the person is
  pre-selected or labelled as recommended ([ADR 0008](adr/0008-active-choice.md)).
- **Implemented by** ONB-09.
- **Evidence.**
  - When preferences differ widely and people tend to put decisions off, requiring an active
    decision can beat any default ([Carroll et al. 2009](#ref-carroll2009)).
  - Asking for an active choice and stating the consequences of each option is an alternative to
    defaults where defaults do not fit ([Keller et al. 2011](#ref-keller2011)).
  - Autonomy is one of the three basic psychological needs whose satisfaction supports
    self-motivation ([Ryan & Deci 2000](#ref-ryan2000)).
- **Confidence.** The evidence comes from retirement saving and health decisions; it has not been
  tested in self-control tools.

### Rules read as if-then plans

- **Decision.** The rule wizard builds a rule as "when this happens, then WebHandbrake does that"
  and states the plan in one sentence before it is created.
- **Implemented by** ONB-08.
- **Evidence.**
  - A meta-analysis of 642 tests found benefits of implementation intentions on cognitive,
    emotional and behavioural outcomes, with d from .27 to .66, and larger effects for if-then
    wording, highly motivated people and rehearsed plans
    ([Sheeran et al. 2025](#ref-sheeran2025)). It replaces the earlier estimate of d = .65 over 94
    tests ([Gollwitzer & Sheeran 2006](#ref-gollwitzer2006)).
  - Tools that redirect to another activity automate implementation intentions
    ([Lyngs et al. 2019](#ref-lyngs2019)).
- **Confidence.** Strong evidence for plans that people form themselves; whether a sentence that
  the product writes works the same way is untested.

### Explain every decision

- **Decision.** Every restriction can be explained: **Why?** is at most two interactions away, and
  **Test a URL** checks any address against the rules being edited.
- **Implemented by** USAB-02, MAT-16.
- **Evidence.**
  - A nudge is transparent when the person can work out its intention and means; non-transparent
    nudges risk manipulating choice ([Hansen & Jespersen 2013](#ref-hansen2013)).
  - A review of 23 nudging mechanisms in human-computer interaction discusses what makes them work
    and their ethical implications ([Caraban et al. 2019](#ref-caraban2019)).
- **Confidence.** This is an ethical argument, not evidence of a larger effect.

### Personal reasons and typed commitments

- **Decision.** A rule can carry a personal reason, shown on the page that stops the person. A
  challenge can ask for a phrase the person chose instead of random characters.
- **Implemented by** MOT-01, INT-04.
- **Evidence.**
  - In a study with 58 students, both goal reminders and removing the Facebook newsfeed helped them
    stay focused; reminders were often found annoying, and some missed the news
    ([Lyngs et al. 2020](#ref-lyngs2020)).
  - In a ten-week within-subject field experiment (N = 54), typing a self-affirmation to unlock the
    phone reduced app use by over 50%, and openings and duration by over 25%, more than showing the
    affirmation alone or typing meaningless text ([Xu et al. 2022](#ref-xu2022)).
- **Confidence.** Two studies, one platform each. Random characters remain the default challenge;
  suggesting a commitment phrase is a [roadmap candidate](roadmap.md#candidates).

### Precise targets rather than whole sites

- **Decision.** Rules can target sections, single pages, the home page only, query parameters and
  embedded content, with exceptions, so that a useful part of a site can stay open.
- **Implemented by** MAT-01, MAT-03, MAT-04, MAT-07, MAT-13.
- **Evidence.** In a survey of 120 YouTube users, autoplay and recommendations mainly undermined
  the sense of agency, while search and playlists supported it; in 13 co-design sessions, people
  with a specific intention preferred interfaces that support agency
  ([Lukoff et al. 2021](#ref-lukoff2021)).
- **Confidence.** One platform, survey and co-design data. WebHandbrake can restrict a page such as
  a home page feed, not an element inside a page.

### Neutral wording

- **Decision.** Interface text describes, never judges: "times you chose not to go in", no
  rankings, no "wasted time" ([Writing](design.md#writing)).
- **Implemented by** ETH-01, ETH-04.
- **Evidence.** In an eight-week study with 24 people, only the group shown the time spent on
  distracting activities (negative framing) became more productive
  ([Kim et al. 2016](#ref-kim2016)).
- **Confidence.** Neutral wording is a deliberate trade-off for the reasons under
  [Ethics](#ethics): it may give up some effect.

### Statistics support awareness, not change

- **Decision.** **Insights** shows patterns next to the rules, and never replaces them as the means
  of change.
- **Implemented by** STA-01, STA-02, STA-03.
- **Evidence.** In a longitudinal field study (N = 242), tracking raised self-awareness but was
  unlikely to reduce use; in an online experiment (N = 139), people preferred monitoring to
  restricting although they rated it less effective ([Zimmermann 2021](#ref-zimmermann2021)).
- **Confidence.** One field study and one experiment.

## What the evidence does not show

- **WebHandbrake has not been evaluated.** The figures above come from other tools, mostly phone
  apps, and are not WebHandbrake's.
- **No wellbeing benefit is shown.** A meta-analysis of 10 studies (N = 4,674) found no significant
  effect of social media abstinence on positive affect, negative affect or life satisfaction
  ([Lemahieu et al. 2025](#ref-lemahieu2025)), and a review of 21 digital detox studies found mixed
  results ([Radtke et al. 2022](#ref-radtke2022)). WebHandbrake makes no wellbeing or addiction
  claim.
- **Most studies are short, on smartphones, with self-selected users.** A browser extension acts
  before a page loads and on addresses, and another browser or device bypasses it.
- **Components are not separated.** The best effect estimates cover whole interventions, not the
  length of a wait or of a challenge.
- **Showing "times you chose not to go in"** as encouragement is an untested hypothesis.

## Ethics

- **Autonomy-supportive design.** Design should support basic psychological needs at every level,
  from adopting a technology to life as a whole ([Peters et al. 2018](#ref-peters2018)). In
  WebHandbrake the person chooses the sites, the step and the firmness, can always see why and until
  when, and keeps a way out.
- **Transparent nudges only.** Every intervention says what it is, and **Why?** explains it
  ([Hansen & Jespersen 2013](#ref-hansen2013)).
- **No attention-capture deceptive patterns**
  ([Monge Roffarello et al. 2023](#ref-mongeroffarello2023b)). WebHandbrake has no streaks, no
  rankings and no notifications meant to bring the person back.
- **No shaming and no wellbeing claims** (ETH-01, ETH-04).
- **Uninstalling is always possible** (ETH-03). Strict protection can block the browser's extension
  pages on a computer, but it cannot prevent uninstalling, and the documents say so.

## Accessibility of friction

Friction adds effort on purpose, and that effort falls unevenly on people with motor or cognitive
disabilities ([Schwartz & Monge Roffarello 2026](#ref-schwartz2026)).

- **Waits are delays, not time limits.** A wait delays a choice; it does not limit the time to
  complete a task. The time limits that exist are the expiry of a cost (`TICKET_TTL_MS` in
  `src/engine/limits.ts`) and the window for confirming a pending change after its cooling-off
  (the `confirmHours` protection setting in `src/engine/types.ts`). Whether they meet WCAG 2.2
  success criterion 2.2.1 Timing Adjustable ([W3C 2023](#ref-w3c2023)) has not been evaluated.
- **Every typed challenge has an alternative** (A11Y-05): a code drawn as an image offers **I use a
  screen reader: type a sentence instead**.
- **Costs can avoid typing and waiting.** Interventions such as **Reminder**, **Filter**, **Block**
  and **Redirect** need neither. **Ask what I want to do** starts with a short wait
  (`frictionIntervention()` in `src/engine/defaults.ts`) that the rule editor can set to zero. A
  break can cost only a confirmation.
- A non-typing alternative as an option of its own is a [roadmap candidate](roadmap.md#candidates).

## Evaluating without telemetry

WebHandbrake measures nothing for its developers. A person can evaluate it on themselves: Insights
keeps daily totals on the device and exports them as CSV or JSON. Logged totals are the better
measure, because self-reported media use correlates only moderately with logged use
([Parry et al. 2021](#ref-parry2021)). Any study must be opt-in and separate from the extension,
and WebHandbrake does not collect analytics, not even to learn whether it works.

## References

One entry per work, cited by this document, the ADRs or the [roadmap](roadmap.md). *Checked
against* says what the cited claims were checked against: the full text of the work, or only its
abstract and published excerpts.

- <a id="ref-anderson2016"></a>Anderson, B. B., Vance, A., Kirwan, C. B., Jenkins, J. L., & Eargle,
  D. (2016). From warning to wallpaper: Why the brain habituates to security warnings and what can
  be done about it. *Journal of Management Information Systems*, 33(3), 713–743.
  <https://doi.org/10.1080/07421222.2016.1243947>.
  *Checked against: abstract.*
- <a id="ref-bitwarden2026"></a>Bitwarden (2026). About Emergency Access. Bitwarden Help Center.
  <https://bitwarden.com/help/emergency-access/>.
  *Checked against: abstract.*
- <a id="ref-caraban2019"></a>Caraban, A., Karapanos, E., Gonçalves, D., & Campos, P. (2019). 23
  ways to nudge: A review of technology-mediated nudging in human-computer interaction. *CHI '19*.
  <https://doi.org/10.1145/3290605.3300733>.
  *Checked against: abstract.*
- <a id="ref-carroll2009"></a>Carroll, G. D., Choi, J. J., Laibson, D., Madrian, B. C., & Metrick,
  A. (2009). Optimal defaults and active decisions. *Quarterly Journal of Economics*, 124(4),
  1639–1674. <https://doi.org/10.1162/qjec.2009.124.4.1639>.
  *Checked against: abstract.*
- <a id="ref-epstein2016"></a>Epstein, D. A., Caraway, M., Johnston, C., Ping, A., Fogarty, J., &
  Munson, S. A. (2016). Beyond abandonment to next steps: Understanding and designing for life after
  personal informatics tool use. *CHI '16*, 1109–1113. <https://doi.org/10.1145/2858036.2858045>.
  *Checked against: abstract.*
- <a id="ref-furnas1987"></a>Furnas, G. W., Landauer, T. K., Gomez, L. M., & Dumais, S. T. (1987).
  The vocabulary problem in human-system communication. *Communications of the ACM*, 30(11),
  964–971. <https://doi.org/10.1145/32206.32212>.
  *Checked against: abstract.*
- <a id="ref-gamblingcommission2025"></a>Gambling Commission (2025). Remote gambling and software
  technical standards, RTS 12: Financial limits.
  <https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-12-financial-limits>.
  *Checked against: abstract.*
- <a id="ref-gollwitzer2006"></a>Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions
  and goal achievement: A meta-analysis of effects and processes. *Advances in Experimental Social
  Psychology*, 38. <https://doi.org/10.1016/S0065-2601(06)38002-1>.
  *Checked against: abstract.*
- <a id="ref-gruning2023"></a>Grüning, D. J., Riedel, F., & Lorenz-Spreen, P. (2023). Directing
  smartphone use through the self-nudge app one sec. *Proceedings of the National Academy of
  Sciences*, 120(8), e2213114120. <https://doi.org/10.1073/pnas.2213114120>.
  *Checked against: abstract.*
- <a id="ref-haliburton2024"></a>Haliburton, L., Grüning, D. J., Riedel, F., Schmidt, A., &
  Terzimehić, N. (2024). A longitudinal in-the-wild investigation of design frictions to prevent
  smartphone overuse. *CHI '24*. <https://doi.org/10.1145/3613904.3642370>.
  *Checked against: abstract.*
- <a id="ref-hansen2013"></a>Hansen, P. G., & Jespersen, A. M. (2013). Nudge and the manipulation of
  choice. *European Journal of Risk Regulation*, 4(1), 3–28.
  <https://doi.org/10.1017/S1867299X00002762>.
  *Checked against: abstract.*
- <a id="ref-john2020"></a>John, A. (2020). When commitment fails: Evidence from a field experiment.
  *Management Science*. <https://doi.org/10.1287/mnsc.2018.3236>.
  *Checked against: abstract.*
- <a id="ref-keller2011"></a>Keller, P. A., Harlam, B., Loewenstein, G., & Volpp, K. G. (2011).
  Enhanced active choice: A new method to motivate behavior change. *Journal of Consumer
  Psychology*, 21(4), 376–383. <https://doi.org/10.1016/j.jcps.2011.06.003>.
  *Checked against: abstract.*
- <a id="ref-kim2016"></a>Kim, Y.-H., Jeon, J. H., Choe, E. K., Lee, B., Kim, K., & Seo, J. (2016).
  TimeAware: Leveraging framing effects to enhance personal productivity. *CHI '16*, 272–283.
  <https://terpconnect.umd.edu/~choe/download/CHI-2016-Kim-TimeAware.pdf>.
  *Checked against: abstract.*
- <a id="ref-kim2019"></a>Kim, J., Jung, H., Ko, M., & Lee, U. (2019). GoalKeeper: Exploring
  interaction lockout mechanisms for regulating smartphone use. *Proceedings of the ACM on
  Interactive, Mobile, Wearable and Ubiquitous Technologies*, 3(1), Article 16.
  <https://doi.org/10.1145/3314403>.
  *Checked against: abstract.*
- <a id="ref-kovacs2018"></a>Kovacs, G., Wu, Z., & Bernstein, M. S. (2018). Rotating online behavior
  change interventions increases effectiveness but also increases attrition. *Proceedings of the ACM
  on Human-Computer Interaction*, 2 (CSCW), Article 95. <https://doi.org/10.1145/3274364>.
  *Checked against: abstract.*
- <a id="ref-kovacs2021"></a>Kovacs, G., Wu, Z., & Bernstein, M. S. (2021). Not now, ask later:
  Users weaken their behavior change regimen over time, but expect to re-strengthen it imminently.
  *CHI '21*. <https://doi.org/10.1145/3411764.3445695>.
  *Checked against: abstract.*
- <a id="ref-lemahieu2025"></a>Lemahieu, L., et al. (2025). The effects of social media abstinence
  on affective well-being and life satisfaction: A systematic review and meta-analysis. *Scientific
  Reports*. <https://doi.org/10.1038/s41598-025-90984-3>.
  *Checked against: abstract.*
- <a id="ref-lukoff2021"></a>Lukoff, K., et al. (2021). How the design of YouTube influences user
  sense of agency. *CHI '21*. <https://doi.org/10.1145/3411764.3445467>.
  *Checked against: abstract.*
- <a id="ref-lukoff2023"></a>Lukoff, K., Lyngs, U., Shirokova, K., Rao, R., Tian, L., Zade, H.,
  Munson, S. A., & Hiniker, A. (2023). SwitchTube: A proof-of-concept system introducing "adaptable
  commitment interfaces" as a tool for digital wellbeing. *CHI '23*, Article 197.
  <https://doi.org/10.1145/3544548.3580703>.
  *Checked against: abstract.*
- <a id="ref-lyngs2019"></a>Lyngs, U., Lukoff, K., Slovak, P., Binns, R., Slack, A., Inzlicht, M.,
  Van Kleek, M., & Shadbolt, N. (2019). Self-control in cyberspace: Applying dual systems theory to
  a review of digital self-control tools. *CHI '19*. <https://doi.org/10.1145/3290605.3300361>.
  *Checked against: full text (the review as reproduced in chapter 2 of the first author's
  doctoral thesis, <https://github.com/ulyngs/phd-thesis>).*
- <a id="ref-lyngs2020"></a>Lyngs, U., et al. (2020). "I just want to hack myself to not get
  distracted": Evaluating design interventions for self-control on Facebook. *CHI '20*.
  <https://doi.org/10.1145/3313831.3376672>.
  *Checked against: abstract.*
- <a id="ref-mark2018"></a>Mark, G., Czerwinski, M., & Iqbal, S. T. (2018). Effects of individual
  differences in blocking workplace distractions. *CHI '18*.
  <https://doi.org/10.1145/3173574.3173666>.
  *Checked against: abstract.*
- <a id="ref-meinhardt2026"></a>Meinhardt, L.-M., Dragic, M., Colley, M., Lukoff, K., & Rukzio, E.
  (2026). Can't stop: How context and individual traits influence effectiveness of different gradual
  interventions for infinite scrolling on short-form video platforms. *Proceedings of the ACM on
  Interactive, Mobile, Wearable and Ubiquitous Technologies*. <https://arxiv.org/abs/2607.15818>.
  *Checked against: abstract.*
- <a id="ref-mongeroffarello2023"></a>Monge Roffarello, A., & De Russis, L. (2023). Achieving
  digital wellbeing through digital self-control tools: A systematic review and meta-analysis. *ACM
  Transactions on Computer-Human Interaction*, 30(4), Article 53. <https://doi.org/10.1145/3571810>.
  *Checked against: abstract.*
- <a id="ref-mongeroffarello2023b"></a>Monge Roffarello, A., Lukoff, K., & De Russis, L. (2023).
  Defining and identifying attention capture deceptive designs in digital interfaces. *CHI '23*.
  <https://doi.org/10.1145/3544548.3580729>.
  *Checked against: abstract.*
- <a id="ref-parry2021"></a>Parry, D. A., Davidson, B. I., Sewall, C. J. R., Fisher, J. T.,
  Mieczkowski, H., & Quintana, D. S. (2021). A systematic review and meta-analysis of discrepancies
  between logged and self-reported digital media use. *Nature Human Behaviour*, 5(11), 1535–1547.
  <https://doi.org/10.1038/s41562-021-01117-5>.
  *Checked against: abstract.*
- <a id="ref-peters2018"></a>Peters, D., Calvo, R. A., & Ryan, R. M. (2018). Designing for
  motivation, engagement and wellbeing in digital experience. *Frontiers in Psychology*, 9, 797.
  <https://doi.org/10.3389/fpsyg.2018.00797>.
  *Checked against: abstract.*
- <a id="ref-radtke2022"></a>Radtke, T., Apel, T., Schenkel, K., Keller, J., & von Lindern, E.
  (2022). Digital detox: An effective solution in the smartphone era? A systematic literature
  review. *Mobile Media & Communication*, 10(2), 190–215.
  <https://doi.org/10.1177/20501579211028647>.
  *Checked against: abstract.*
- <a id="ref-ryan2000"></a>Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the
  facilitation of intrinsic motivation, social development, and well-being. *American Psychologist*,
  55(1), 68–78. <https://doi.org/10.1037/0003-066X.55.1.68>.
  *Checked against: abstract.*
- <a id="ref-schwartz2026"></a>Schwartz, R. E., & Monge Roffarello, A. (2026). Intervention design
  at the intersection of accessibility and digital wellbeing. *SAC '26*.
  <https://doi.org/10.1145/3748522.3779978>.
  *Checked against: abstract.*
- <a id="ref-sheeran2025"></a>Sheeran, P., Listrom, O., & Gollwitzer, P. M. (2025). The when and how
  of planning: Meta-analysis of the scope and components of implementation intentions in 642 tests.
  *European Review of Social Psychology*, 36(1), 162–194.
  <https://doi.org/10.1080/10463283.2024.2334563>.
  *Checked against: abstract.*
- <a id="ref-sjosten2017"></a>Sjösten, A., Van Acker, S., & Sabelfeld, A. (2017). Discovering
  browser extensions via web accessible resources. *CODASPY '17*, 329–336.
  <https://doi.org/10.1145/3029806.3029820>.
  *Checked against: abstract.*
- <a id="ref-w3c2023"></a>W3C (2023). Understanding SC 2.2.1: Timing Adjustable (Level A). Web
  Content Accessibility Guidelines 2.2.
  <https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html>.
  *Checked against: abstract.*
- <a id="ref-xu2022"></a>Xu, X., et al. (2022). TypeOut: Leveraging just-in-time self-affirmation
  for smartphone overuse reduction. *CHI '22*. <https://doi.org/10.1145/3491102.3517476>.
  *Checked against: abstract.*
- <a id="ref-zimmermann2021"></a>Zimmermann, L. (2021). "Your screen-time app is keeping track":
  Consumers are happy to monitor but unlikely to reduce smartphone usage. *Journal of the
  Association for Consumer Research*, 6(3), 377–382. <https://doi.org/10.1086/714365>.
  *Checked against: abstract.*
