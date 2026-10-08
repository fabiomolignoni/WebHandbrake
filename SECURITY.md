# Security policy

## Supported versions

Security fixes are made for the latest version published in the Chrome Web Store and on Firefox
Add-ons, and on the `main` branch. Before the first store release, report vulnerabilities against
the `main` branch.

## Report a vulnerability

Do not open a public issue, discussion or pull request about a vulnerability.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**, or go directly to
[the private reporting form](https://github.com/fabiomolignoni/WebHandbrake/security/advisories/new).
Only you and the maintainer can see the report. This is the only channel: no e-mail address is
published.

## What to include

- The browser and its version.
- The WebHandbrake version, shown in **Help › About**.
- The steps to reproduce the problem.
- The impact: what an attacker can read, change or get around.
- Whether it needs a malicious web page, a crafted file or another extension.

## What to expect

- An acknowledgement within 7 days.
- A first assessment within 14 days.
- A fix, or a coordinated disclosure, within 90 days. A longer delay is agreed with you first.
- Credit in the advisory, unless you prefer to stay anonymous.

Research done in good faith and in line with this policy will not lead to legal action by the
maintainer.

## Scope

In scope:

- A web page that reads or changes WebHandbrake's data.
- Code that runs in an extension page or in the background without the user's choice.
- Getting around a cost, wait, cooling-off period or time when settings cannot be loosened that
  the background enforces, for example by editing an extension page or by crafting a file to
  import.
- Unsafe handling of imported files or of regular expressions.
- A published package that contains code meant only for the tests.

Out of scope: getting around WebHandbrake with control of the device or the browser, such as
uninstalling it, using another browser or profile, changing the system time zone, or editing the
browser profile on disk. These are design limits, listed in the
[threat model](docs/threat-model.md#vulnerability-or-design-limit).

## How fixes are published

A fixed vulnerability gets a GitHub security advisory, an entry under **Security** in
[CHANGELOG.md](CHANGELOG.md) and an update in the stores.

## Security design

The assets, the adversaries and the protections are described in the
[threat model](docs/threat-model.md).
