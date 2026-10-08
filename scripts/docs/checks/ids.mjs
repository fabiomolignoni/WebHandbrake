/**
 * ids: requirement and circumvention-route IDs are defined once and cited consistently.
 *
 * (a) The items of docs/requirements.md parse (see scripts/docs/spec.mjs), IDs are unique and each
 *     anchor is the lowercase ID. (b) Every ID cited in src/, scripts/, tests/, the configuration
 *     and any Markdown file is defined (CIR IDs in docs/threat-model.md). (c) src/ and tests/ cite
 *     no planned or withdrawn ID; the two ends of a range such as "ENF-02…ENF-12" are exempt.
 *     (d) A declared verification has its evidence: unit or e2e, a test title of that kind cites
 *     the ID; manual, a line of docs/testing.md#manual-checks starts with it; ci or review, the Note
 *     names the check, file or function (a code span or a link); study, the status is unverified
 *     or the Note links the result. (e) Partial and unverified items have a Note. (f) Implemented,
 *     partial and unverified items declare a verification. (g) docs/roadmap.md cites no implemented
 *     ID. (h) User-facing documents and interface strings cite no ID.
 */

import { isCode, isUserFacing, LOCALE, MANIFEST_LOCALE, SPEC, TOOLS_DIR } from '../config.mjs';
import {
  citedIds,
  idPattern,
  parseManualChecks,
  parseRequirements,
  parseRoutes,
  testEvidence,
} from '../spec.mjs';

export default {
  slug: 'ids',
  scope: 'global',
  description: 'requirement and CIR IDs: items parse, citations are defined, verifications have evidence',
  async run({ repo }) {
    const problems = [];
    const reqDoc = repo.doc(SPEC.requirements);
    if (!reqDoc)
      return [{ path: SPEC.requirements, message: 'does not exist; it defines every requirement ID.' }];
    const parsed = parseRequirements(reqDoc);
    problems.push(...parsed.problems);
    const items = new Map();
    for (const item of parsed.items) {
      if (items.has(item.id))
        problems.push({
          path: SPEC.requirements,
          line: item.line,
          message: `${item.id} is defined twice (also line ${items.get(item.id).line}).`,
        });
      else items.set(item.id, item);
    }
    const tmDoc = repo.doc(SPEC.threatModel);
    const routes = new Map();
    if (tmDoc) {
      const r = parseRoutes(tmDoc);
      problems.push(...r.problems);
      for (const route of r.routes) {
        if (routes.has(route.id))
          problems.push({
            path: SPEC.threatModel,
            line: route.line,
            message: `${route.id} is defined twice.`,
          });
        routes.set(route.id, route);
      }
    }
    const prefixes = new Set([...[...items.keys()].map((id) => id.split('-')[0]), 'CIR']);
    const re = idPattern(prefixes);
    const defined = (id) => items.has(id) || routes.has(id);

    // (b), (c), (g), (h): citations.
    const sources = [
      ...repo.markdown().map((p) => ({ path: p, text: repo.read(p) })),
      ...repo
        .files()
        .filter((p) => isCode(p) && !p.startsWith(TOOLS_DIR))
        .map((p) => ({ path: p, text: repo.read(p) })),
    ];
    for (const { path, text } of sources) {
      if (text === null || text.includes('\0')) continue;
      const strings = path === LOCALE || path === MANIFEST_LOCALE;
      text.split('\n').forEach((line, i) => {
        for (const c of citedIds(line, re)) {
          const at = { path, line: i + 1 };
          if (!defined(c.id)) {
            const where = c.id.startsWith('CIR-') ? SPEC.threatModel : SPEC.requirements;
            problems.push({ ...at, message: `${c.id} is not defined in ${where}.` });
            continue;
          }
          const item = items.get(c.id);
          if (
            item &&
            !c.inRange &&
            ['planned', 'withdrawn'].includes(item.status) &&
            /^(src|tests)\//.test(path) &&
            !strings
          )
            problems.push({
              ...at,
              message: `${c.id} is ${item.status}: code and tests cite only existing behaviour.`,
            });
          if (item && path === SPEC.roadmap && item.status === 'implemented')
            problems.push({
              ...at,
              message: `${c.id} is implemented: the roadmap cites only what is not done.`,
            });
          if (isUserFacing(path) || strings)
            problems.push({ ...at, message: `${c.id}: user-facing text cites no requirement IDs.` });
        }
      });
    }

    // (d), (e), (f): verification and evidence.
    const evidence = testEvidence(repo, re);
    const testing = repo.doc(SPEC.testing);
    const manual = testing ? parseManualChecks(testing) : null;
    const manualIds = new Set((manual ?? []).flatMap((m) => m.ids));
    for (const m of manual ?? []) {
      for (const id of m.ids)
        if (!defined(id))
          problems.push({ path: SPEC.testing, line: m.line, message: `${id} is not defined.` });
    }
    for (const item of items.values()) {
      if (['planned', 'withdrawn'].includes(item.status)) continue;
      const at = { path: SPEC.requirements, line: item.line };
      const v = item.verification;
      if (!v.length)
        problems.push({ ...at, message: `${item.id} is ${item.status} but declares no verification.` });
      if (['partial', 'unverified'].includes(item.status) && !item.note)
        problems.push({
          ...at,
          message: `${item.id} is ${item.status}: add a Note that says what is missing.`,
        });
      const ev = evidence.get(item.id) ?? { unit: [], e2e: [] };
      for (const kind of ['unit', 'e2e'])
        if (v.includes(kind) && !ev[kind].length)
          problems.push({
            ...at,
            message: `${item.id} is ${item.status} with verification ${kind}, but no ${kind} test title cites it.`,
          });
      if (v.includes('manual') && !manualIds.has(item.id))
        problems.push({
          ...at,
          message: `${item.id} declares manual verification, but no line of ${SPEC.testing}#manual-checks starts with it.`,
        });
      const named = /`[^`]+`|\]\(/.test(item.note);
      for (const kind of ['ci', 'review'])
        if (v.includes(kind) && !named)
          problems.push({
            ...at,
            message: `${item.id} declares ${kind}: the Note must name the check, file or function.`,
          });
      if (v.includes('study') && item.status !== 'unverified' && !/\]\(/.test(item.note))
        problems.push({
          ...at,
          message: `${item.id} declares study: it is unverified, or its Note links the result.`,
        });
    }
    return problems;
  },
};
