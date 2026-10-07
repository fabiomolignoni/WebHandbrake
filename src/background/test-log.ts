/**
 * What the end-to-end suite observes in the test build (__TEST__): errors, notifications and
 * context menu items. Every call site is guarded by `if (__TEST__)`, so nothing here is shipped.
 */

export const testLog = {
  errors: [] as string[],
  notifications: [] as { id: string; title: string; message: string }[],
  menus: [] as { id: string; parentId?: string; title?: string }[],
};
