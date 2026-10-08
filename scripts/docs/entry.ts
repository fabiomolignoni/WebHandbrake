/**
 * The pure modules that the documentation tools read, bundled for Node by scripts/docs/ts.mjs.
 * Only modules without browser APIs belong here.
 */

export {
  defaultShortcut,
  HELP_TOPICS,
  helpFacts,
  SHORTCUTS,
  SYNTAX,
} from '../../src/dashboard/help-content';
export { TEMPLATES } from '../../src/data/templates';
export { defaultConfig } from '../../src/engine/defaults';
export {
  EXPORT_FORMAT,
  EXPORT_RULE_FORMAT,
  EXPORT_RULE_VERSION,
  EXPORT_VERSION,
} from '../../src/engine/importers';
export * as limits from '../../src/engine/limits';
export { SCHEMA_VERSION } from '../../src/engine/types';
export { formatMessage, parse as parseMessage } from '../../src/i18n/icu';
