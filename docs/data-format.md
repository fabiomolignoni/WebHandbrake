# Data format

The files WebHandbrake writes and reads. They are the extension's public interface: a change that
breaks them is a major release ([versioning](releasing.md#versioning)). What each stored item
means for your privacy is in [PRIVACY.md](../PRIVACY.md).

## Export file

**Settings › Data › Export** writes `webhandbrake-<date and time>.json`:

| Field | Content |
| --- | --- |
| `format` | `"<!-- fact: data.exportFormat -->webhandbrake<!-- /fact -->"` |
| `version` | <!-- fact: data.exportVersion -->1<!-- /fact --> |
| `exportedAt` | The time of the export (ISO 8601) |
| `config` | Rules, shared lists, **Always allowed** and settings, at configuration schema version <!-- fact: data.schemaVersion -->1<!-- /fact -->. The settings password is replaced by `null` unless **Include the password hash** is ticked; it is only ever a salted hash. |
| `later` | Pages saved for later, with their full addresses and titles |
| `statistics` | Only with **Include statistics**: one record per day |

The file is plain, unencrypted JSON: keep it where you keep other private files.

## Single rule file

**Share** in a rule's menu writes one rule and the shared lists it uses:
`{ "format": "<!-- fact: data.exportRuleFormat -->webhandbrake-group<!-- /fact -->", "version": <!-- fact: data.exportRuleVersion -->1<!-- /fact -->, "group": …, "lists": … }`.
Importing it adds the rule as a new one.

## Importing

**Settings › Data › Import** accepts a file or pasted text of up to
<!-- fact: limits.MAX_IMPORT_BYTES -->10485760<!-- /fact --> characters:

- **An export file.** Choose **Add to my rules** or **Replace everything**. A preview shows each change and whether it
  makes your rules looser; the import then goes through your protection level like any other
  change. Pages saved for later are restored only with **Replace everything**. Exported statistics are never
  imported.
- **A single rule file**, added as a new rule.
- **A list of sites**, one per line, turned into a new rule: addresses written as in the rule
  editor, full URLs, hosts-file lines (`0.0.0.0 example.com`), uBlock Origin and AdGuard filters
  (`||example.com^`), uBlacklist and match patterns (`*://*.example.com/*`), and JSON that
  contains URLs. Lines that cannot be used are listed in a report, not imported.

## Compatibility

- Exports from a newer version of WebHandbrake are read as far as this version understands them.
- Unknown fields are kept at the level of the configuration, rules, shared lists, addresses and
  settings. Unknown fields inside a rule's conditions are dropped when the configuration is saved.
- A change of the configuration schema comes with a migration that runs when the extension
  starts; a copy of the configuration before the migration is kept until the next successful save.

## Redirect addresses

The **Redirect** intervention opens a web address of your choice (`http` or `https` only). In it,
`{url}` is replaced by the address that was redirected, `{group}` by the rule's name and
`{until}` by the time the restriction ends. The destination itself is never redirected.

## Custom style for the intervention page

**Settings › Interventions › Custom style for intervention pages** applies to every intervention page. `url()`,
`@import` and `expression()` are removed, so it cannot load anything, and it is cut at
<!-- fact: limits.MAX_CUSTOM_CSS_CHARS -->20000<!-- /fact --> characters.
