# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability
reporting ("Report a vulnerability" in the Security tab of the repository). We aim to acknowledge
reports within 7 days and to publish a fix and an advisory as soon as possible.

Useful information: browser and version, WebHandbrake version (Settings › Diagnostics), steps to
reproduce, and the impact you observed.

## Scope

In scope: anything that lets a web page read or change WebHandbrake data, run code in the
extension, bypass the protection logic enforced by the background (e.g. a cost or cooling-off
skipped by editing an extension page), unsafe handling of imported files or regular expressions.

Out of scope: circumventions that need full control of the device and are documented in the
requirements (Appendix B), such as uninstalling the extension or using another browser.

## Practices

- No remote code, strict Content Security Policy on every extension page.
- Passwords stored only as salted PBKDF2-SHA256 hashes (600 000 iterations), compared in constant
  time.
- Regular expressions validated against catastrophic backtracking; imported files validated and
  size-limited.
- Messages from content scripts limited to a small allowlist of methods.
- Dependencies kept minimal and monitored by Dependabot.
