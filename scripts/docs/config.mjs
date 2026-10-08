/**
 * Configuration of the documentation tools: the document sets, the word lists of the `words`
 * check, the allowed code spans of user-facing text and the other allowlists. The checks read
 * their rules from here; the glossary (docs/glossary.md) supplies the words to avoid.
 */

export const REPO_URL = 'https://github.com/fabiomolignoni/WebHandbrake';

/** Directories that are build output, caches or dependencies: never scanned. */
export const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'dist-test',
  '.cache',
  'test-results',
  'playwright-report',
  'web-ext-artifacts',
];

/**
 * User-facing documents: read by people who use WebHandbrake or review it for a store. They use
 * interface terms only and cite no requirement IDs.
 */
export const USER_FACING = [
  'README.md',
  'PRIVACY.md',
  'SECURITY.md',
  'SUPPORT.md',
  'CHANGELOG.md',
  'docs/user-guide.md',
  'docs/accessibility.md',
  'docs/store-listings.md',
];

/** The issue forms are user-facing too. */
export const ISSUE_FORMS = /^\.github\/ISSUE_TEMPLATE\/[^/]+\.ya?ml$/;

export const isUserFacing = (path) => USER_FACING.includes(path) || ISSUE_FORMS.test(path);

/** Markdown files without an H1 by design (GitHub inserts their content into a page). */
export const NO_H1 = ['.github/PULL_REQUEST_TEMPLATE.md'];

/** Files whose time words are history or plans by nature (`words` check). */
export const TIME_WORDS_EXEMPT = ['CHANGELOG.md'];

/** The interface locale and the browser-manifest locale (user-facing strings). */
export const LOCALE = 'src/locales/en.json';
export const MANIFEST_LOCALE = 'src/_locales/en/messages.json';

/**
 * In the interface strings only these code words are checked (whole words, case-insensitive); the
 * interface strings are otherwise reviewed by hand against the glossary.
 */
export const STRING_WORDS = ['group', 'groups', 'DNR', 'declarativeNetRequest'];

/** US spellings and their UK form (whole words, case-insensitive). */
export const UK_SPELLING = {
  color: 'colour',
  colors: 'colours',
  colored: 'coloured',
  colorful: 'colourful',
  behavior: 'behaviour',
  behaviors: 'behaviours',
  behavioral: 'behavioural',
  favor: 'favour',
  favors: 'favours',
  favorite: 'favourite',
  favorites: 'favourites',
  center: 'centre',
  centers: 'centres',
  centered: 'centred',
  organize: 'organise',
  organizes: 'organises',
  organized: 'organised',
  organizing: 'organising',
  organization: 'organisation',
  recognize: 'recognise',
  recognizes: 'recognises',
  recognized: 'recognised',
  analyze: 'analyse',
  analyzes: 'analyses',
  analyzed: 'analysed',
  customize: 'customise',
  customizes: 'customises',
  customized: 'customised',
  customization: 'customisation',
  synchronize: 'synchronise',
  synchronized: 'synchronised',
  minimize: 'minimise',
  prioritize: 'prioritise',
};

/** Proper names that keep their US spelling. */
export const SPELLING_ALLOWED = [
  'GNU General Public License',
  'General Public License',
  'Help Center',
  'Privacy Center',
  'Security Center',
];

/** Words that date a sentence: state what is true instead (plans belong in the roadmap). */
export const TIME_WORDS = [
  'currently',
  'at the moment',
  'at present',
  'for now',
  'nowadays',
  'recently',
  'coming soon',
  'will come',
  'in a future version',
  'v1.1',
  'iteration',
];

/** Status written as emoji or tick marks instead of words. */
export const STATUS_EMOJI = ['✅', '🟡', '⏳', '❌', '✔', '✓', '✗', '✘', '🟢', '🔴'];

/**
 * Code spans allowed in user-facing text although they contain a word to avoid: placeholders of
 * messages, browser enterprise-policy names and files. Manifest permission names and repository
 * paths are allowed too (the `words` check adds them).
 */
export const ALLOWED_CODE_SPANS = [
  '{group}',
  '{url}',
  '{until}',
  'policies.json',
  'ExtensionInstallForcelist',
  'ExtensionSettings',
  'IncognitoModeAvailability',
  'BrowserGuestModeEnabled',
  'BrowserAddPersonEnabled',
  'DeveloperToolsAvailability',
  'DisablePrivateBrowsing',
  'DisableSafeMode',
  'DisableDeveloperTools',
];

/** Environment variables that are not part of the test configuration (`env-vars` check). */
export const ENV_IGNORED = ['NODE_ENV', 'CI'];

/** Where environment variables are read (`env-vars` check). */
export const ENV_SOURCES =
  /^(tests\/.*\.(ts|mjs|js)|scripts\/.*\.(ts|mjs|js)|playwright\.config\.ts|vitest\.config\.ts)$/;

/**
 * Code and configuration scanned for citations (IDs, "ADR NNNN", document links, npm scripts):
 * everything under src/, scripts/, tests/, static/ and .github/ except Markdown and images, and the root
 * configuration files.
 */
export function isCode(path) {
  if (/\.(md|png|jpe?g|gif|svg|ico|woff2?|zip|xpi)$/i.test(path)) return false;
  return (
    /^(src|scripts|tests|static|\.github)\//.test(path) ||
    ['playwright.config.ts', 'vitest.config.ts', 'package.json'].includes(path)
  );
}

/** The documentation tools themselves: they name documents and IDs as examples. */
export const TOOLS_DIR = 'scripts/docs/';

/** Lines that may use "§" for an external specification (`obsolete-refs` check). */
export const SECTION_SIGN_ALLOWED = /WebDriver|W3C/;

/** Requirement document, threat model and the tests' manual list (`ids` check, traceability). */
export const SPEC = {
  requirements: 'docs/requirements.md',
  threatModel: 'docs/threat-model.md',
  roadmap: 'docs/roadmap.md',
  testing: 'docs/testing.md',
  manualChecks: 'manual-checks',
  circumventionRoutes: 'circumvention-routes',
  unitTests: /^tests\/unit\/.*\.test\.ts$/,
  e2eTests: /^tests\/e2e\/.*\.spec\.ts$/,
};

/** Path prefixes that make a backticked token a repository path (`paths` check). */
export const PATH_PREFIXES = ['src/', 'scripts/', 'tests/', 'docs/', 'static/', '.github/'];

/** Root files that documents name without a directory (`paths` check). */
export const ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'biome.json',
  'playwright.config.ts',
  'vitest.config.ts',
  '.nvmrc',
  '.gitignore',
  'LICENSE',
];

/** The runtime dependencies allowed by ADR 0002 (`toolchain` check). */
export const RUNTIME_DEPENDENCIES = ['preact'];
export const LICENSE_ID = 'GPL-3.0-or-later';

/** Allowed values in the header lines of an ADR. */
export const ADR_STATUS = /^(proposed|accepted|deprecated|superseded by ADR \d{4})$/;
export const ADR_HEADER_KEYS = ['Status', 'Date', 'Recorded', 'Requirements', 'Supersedes'];
export const ADR_SECTIONS = [
  'Context and problem statement',
  'Considered options',
  'Decision outcome',
  'Consequences',
  'Confirmation',
];

/** Keep a Changelog 1.1.0 change types. */
export const CHANGE_TYPES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
