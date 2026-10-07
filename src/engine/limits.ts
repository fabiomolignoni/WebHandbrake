/**
 * Caps, retention periods, time-outs and other fixed limits, in one pure module.
 *
 * The code and the Help parameters (src/dashboard/help-content.ts) read these values from here;
 * documents cite them by name instead of copying the numbers. The suffix of each name gives its
 * unit: _MS milliseconds, _MINUTES, _DAYS, _BYTES, _CHARS characters; a name without a unit suffix
 * is a count. Add a constant here only when a document or a string cites it.
 */

/** Automatic backups kept from the most recent configuration changes. */
export const RECENT_SNAPSHOTS = 20;

/** Automatic backups kept one per day, for the most recent days. */
export const DAILY_SNAPSHOTS = 30;

/** Delay that batches the writes of counted time and runtime state to storage. */
export const USAGE_FLUSH_MS = 10_000;

/** Protection events (Protection › Events) kept; older ones are dropped. */
export const MAX_PROTECTION_EVENTS = 200;

/** Intentions typed when answering an Ask question that are kept; older ones are dropped. */
export const MAX_INTENTIONS = 500;

/** Pages saved for later that are kept; the oldest ones are dropped. */
export const MAX_LATER_ITEMS = 1000;

/** Break records kept in the runtime state; older ones are dropped. */
export const MAX_BREAK_RECORDS = 1000;

/** Entries kept in the decision log (Settings › Diagnostics › Recent decisions). */
export const DECISION_LOG_SIZE = 200;

/**
 * Days of the totals that limits depend on, kept when statistics are deleted, so that deleting
 * statistics never refills a limit: the longest limit period plus a margin.
 */
export const BUDGET_KEEP_DAYS = 92;

/** Minute counters (for hourly and rolling limits) kept for this many minutes. */
export const MINUTE_RETENTION_MINUTES = 48 * 60;

/** A cost ticket (a question, wait or challenge being answered) expires after this time. */
export const TICKET_TTL_MS = 60 * 60_000;

/** Wrong answers to a ticket that lock it for TICKET_LOCK_MS. */
export const TICKET_MAX_FAILURES = 5;

/** How long a ticket stays locked after TICKET_MAX_FAILURES wrong answers. */
export const TICKET_LOCK_MS = 30_000;

/** PBKDF2-SHA256 iterations for the settings password. */
export const PBKDF2_ITERATIONS = 600_000;

/** Longest regular expression accepted as a site entry. */
export const MAX_REGEX_LENGTH = 1000;

/**
 * Largest import accepted: compared with the file size when a file is picked, and with the length
 * of the text (in characters) when it is imported.
 */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Custom CSS for the intervention page is cut to this length. */
export const MAX_CUSTOM_CSS_CHARS = 20_000;

/** Longest focus session, counted from its start. */
export const MAX_SESSION_MS = 7 * 24 * 3_600_000;

/**
 * Length of a focus session started with the keyboard shortcut, and the duration preselected in
 * the popup and on the Focus page.
 */
export const DEFAULT_SESSION_MINUTES = 25;

/** Durations offered for a quick focus session (popup, Focus page, context menu). */
export const QUICK_SESSION_MINUTES: readonly number[] = [DEFAULT_SESSION_MINUTES, 50, 90];

/** A system clock that goes back by more than this is a backward jump. */
export const CLOCK_JUMP_TOLERANCE_MS = 60_000;

/** An offset from the Date headers larger than this corrects the clock (a clock set forward). */
export const CLOCK_SKEW_THRESHOLD_MS = 10 * 60_000;

/** Date-header samples (one per host) used to estimate the clock offset. */
export const CLOCK_SKEW_SAMPLES = 9;

/** Samples within this distance of the median agree with it. */
export const CLOCK_AGREEMENT_MS = 120_000;

/** Hosts that must agree before the clock offset is trusted. */
export const CLOCK_MIN_AGREEING_HOSTS = 3;

/**
 * The extension was disabled (or did not run) for longer than this before a start that was neither
 * a browser start-up nor an install: a protection event is recorded.
 */
export const INACTIVE_GAP_MS = 10 * 60_000;

/**
 * When the browser filters block a page that the engine allows (stale or broader filters), the page
 * is let through for this long while the filters are rebuilt.
 */
export const RECHECK_GRANT_MS = 2 * 60_000;

/** How far ahead the next decision changes (schedule boundaries, period ends) are looked for. */
export const HORIZON_DAYS = 8;
