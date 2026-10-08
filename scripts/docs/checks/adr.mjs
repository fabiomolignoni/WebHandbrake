/**
 * adr: the architecture decision records follow docs/adr/0000-template.md. File names are
 * NNNN-kebab-case.md, numbered from 0001 without gaps or repeats; the H1 is "ADR NNNN — <title>";
 * the header lines are Status (proposed, accepted, deprecated or "superseded by ADR NNNN"), Date
 * (YYYY-MM-DD) and optionally Recorded, Requirements and Supersedes; the five sections exist, in
 * order, and are not empty; "Supersedes" and "superseded by" agree in both records.
 */

import { ADR_HEADER_KEYS, ADR_SECTIONS, ADR_STATUS } from '../config.mjs';
import { readAdr } from '../generators/adr-index.mjs';

const TEMPLATE = 'docs/adr/0000-template.md';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  return (
    ISO.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)
  );
}

export default {
  slug: 'adr',
  scope: 'file',
  description: 'ADRs: file names, numbering, header lines and the five sections',
  async run({ repo }) {
    const problems = [];
    const files = repo.match(/^docs\/adr\/[^/]+\.md$/).filter((p) => p !== 'docs/adr/README.md');
    const records = [];
    for (const path of files) {
      const name = path.slice('docs/adr/'.length);
      if (!/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)) {
        problems.push({ path, message: `name the file NNNN-kebab-case.md.` });
        continue;
      }
      const number = name.slice(0, 4);
      const adr = readAdr(repo.read(path));
      const doc = repo.doc(path);
      const fail = (message, line) => problems.push({ path, line, message });
      const template = path === TEMPLATE;
      const h1 = doc.headings.find((h) => h.level === 1);
      if (!template && adr.number !== number)
        fail(`the H1 must be '# ADR ${number} — <decision>'.`, h1?.line);
      const h2 = doc.headings.filter((h) => h.level === 2);
      let from = 0;
      for (const title of ADR_SECTIONS) {
        const k = h2.findIndex((h, idx) => idx >= from && h.text === title);
        if (k === -1) {
          fail(
            h2.some((h) => h.text === title)
              ? `section '${title}' is out of order.`
              : `missing section '${title}'.`,
          );
          continue;
        }
        const next = doc.headings.find((h) => h.line > h2[k].line && h.level <= 2);
        const body = doc.lines.slice(h2[k].line, next ? next.line - 1 : doc.lines.length);
        if (!template && !body.some((l) => l.trim())) fail(`section '${title}' is empty.`, h2[k].line);
        from = k + 1;
      }
      if (template) continue;
      const header = adr.header;
      for (const [key, { line }] of Object.entries(header))
        if (!ADR_HEADER_KEYS.includes(key))
          fail(`unknown header line '${key}'; use ${ADR_HEADER_KEYS.join(', ')}.`, line);
      if (!header.Status) fail(`missing header line '- Status: …'.`);
      else if (!ADR_STATUS.test(header.Status.value))
        fail(
          `Status '${header.Status.value}' must be proposed, accepted, deprecated or 'superseded by ADR NNNN'.`,
          header.Status.line,
        );
      if (!header.Date) fail(`missing header line '- Date: YYYY-MM-DD' (the date of the decision).`);
      else if (!validDate(header.Date.value))
        fail(`Date '${header.Date.value}' is not a YYYY-MM-DD date.`, header.Date.line);
      if (header.Recorded) {
        if (!validDate(header.Recorded.value))
          fail(`Recorded '${header.Recorded.value}' is not a YYYY-MM-DD date.`, header.Recorded.line);
        else if (header.Date && header.Recorded.value < header.Date.value)
          fail(
            `Recorded ${header.Recorded.value} is before the decision Date ${header.Date.value}.`,
            header.Recorded.line,
          );
      }
      if (header.Supersedes && !/^ADR \d{4}(, ADR \d{4})*$/.test(header.Supersedes.value))
        fail(`Supersedes must be 'ADR NNNN' (comma-separated).`, header.Supersedes.line);
      records.push({ path, number, header });
    }

    const seen = new Set();
    for (const r of records) {
      if (seen.has(r.number)) problems.push({ path: r.path, message: `ADR ${r.number} is used twice.` });
      seen.add(r.number);
    }
    const max = Math.max(0, ...records.map((r) => Number(r.number)));
    for (let n = 1; n <= max; n++) {
      const id = String(n).padStart(4, '0');
      if (!seen.has(id))
        problems.push({
          path: 'docs/adr',
          message: `ADR ${id} is missing: numbers run from 0001 without gaps.`,
        });
    }

    const byNumber = new Map(records.map((r) => [r.number, r]));
    for (const r of records) {
      const sup = r.header.Status?.value.match(/^superseded by ADR (\d{4})$/);
      if (sup) {
        const other = byNumber.get(sup[1]);
        if (!other)
          problems.push({ path: r.path, message: `superseded by ADR ${sup[1]}, which does not exist.` });
        else if (!(other.header.Supersedes?.value ?? '').includes(`ADR ${r.number}`))
          problems.push({
            path: other.path,
            message: `ADR ${r.number} says it is superseded by this record: add '- Supersedes: ADR ${r.number}'.`,
          });
      }
      for (const m of (r.header.Supersedes?.value ?? '').matchAll(/ADR (\d{4})/g)) {
        const other = byNumber.get(m[1]);
        if (!other) problems.push({ path: r.path, message: `supersedes ADR ${m[1]}, which does not exist.` });
        else if (other.header.Status?.value !== `superseded by ADR ${r.number}`)
          problems.push({
            path: other.path,
            message: `ADR ${r.number} supersedes this record: set '- Status: superseded by ADR ${r.number}'.`,
          });
      }
    }
    return problems;
  },
};
