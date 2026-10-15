/** Types of scripts/release.mjs, for the TypeScript code that imports it (tests). */

export function nextVersion(
  current: string,
  spec: string | undefined,
  tagged: (version: string) => boolean,
): string;
export function closeChangelog(changelog: string, version: string, date: string, repository: string): string;
