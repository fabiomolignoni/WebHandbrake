/** Types of scripts/manifest.mjs, for the TypeScript code that imports it (tests, documentation tools). */

export interface Command {
  suggested_key?: { default?: string };
  description: string;
}

export interface Manifest {
  manifest_version: 3;
  version: string;
  permissions: string[];
  optional_permissions: string[];
  host_permissions: string[];
  commands: Record<string, Command>;
  content_security_policy: { extension_pages: string };
  [key: string]: unknown;
}

export function manifest(target: 'chrome' | 'firefox', version: string): Manifest;
