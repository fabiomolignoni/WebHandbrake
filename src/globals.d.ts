/** Build-time constants (scripts/build.mjs, vitest.config.ts). */

/** True only in the test build used by the end-to-end suite (dist-test/); false in every package. */
declare const __TEST__: boolean;
/** Browser the bundle was built for. */
declare const __TARGET__: 'chrome' | 'firefox';
