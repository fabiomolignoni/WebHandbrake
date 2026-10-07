/**
 * The extension manifest for each target. scripts/build.mjs writes it to
 * dist/<target>/manifest.json; other scripts import it to read the permissions, commands, content
 * security policy and minimum browser versions without building.
 *
 *   import { manifest } from './manifest.mjs';
 *   manifest('chrome' | 'firefox', version)
 */

export function manifest(target, version) {
  const icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    96: 'icons/icon-96.png',
    128: 'icons/icon-128.png',
  };
  const m = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'WebHandbrake',
    description: '__MSG_extDescription__',
    version,
    default_locale: 'en',
    homepage_url: 'https://github.com/fabiomolignoni/WebHandbrake',
    icons,
    action: {
      default_popup: 'popup.html',
      default_title: 'WebHandbrake',
      default_icon: { 16: icons[16], 32: icons[32], 48: icons[48] },
    },
    options_ui: { page: 'dashboard.html', open_in_tab: true },
    permissions: [
      'storage',
      'unlimitedStorage',
      'declarativeNetRequest',
      'tabs',
      'webNavigation',
      'webRequest',
      'alarms',
      'idle',
      'scripting',
      'contextMenus',
    ],
    optional_permissions: ['notifications'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['intervention.html', 'intervention.js', 'ui.css', 'icons/*'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+H' }, description: '__MSG_cmdOpenPopup__' },
      'start-session': { suggested_key: { default: 'Alt+Shift+F' }, description: '__MSG_cmdStartSession__' },
      'block-site': { suggested_key: { default: 'Alt+Shift+B' }, description: '__MSG_cmdBlockSite__' },
      'open-dashboard': { description: '__MSG_cmdOpenDashboard__' },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' data:; style-src 'self'; connect-src 'self'",
    },
  };
  if (target === 'chrome') {
    m.minimum_chrome_version = '121';
    m.background = { service_worker: 'background.js' };
    m.incognito = 'spanning';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: 'webhandbrake@webhandbrake.org',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}
