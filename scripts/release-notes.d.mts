/** Types of scripts/release-notes.mjs, for the TypeScript code that imports it (tests). */

export function tagVersion(tag: string, packageVersion: string): string;
export function releaseNotes(changelog: string, version: string): string;
export function verifyNote(repository: string): string;
