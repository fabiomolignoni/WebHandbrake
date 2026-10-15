/** Helpers for the plain JSON data of the configuration, the runtime state and the files. */

/** A plain object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A deep copy of JSON data, as the storage gives it back: undefined fields are left out. */
export function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
