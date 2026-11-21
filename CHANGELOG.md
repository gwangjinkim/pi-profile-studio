# Changelog

## [Unreleased]

### Removed

- The bundled OpenCode Go inference key. The `opencode-go` provider is registered only when `OPENCODE_API_KEY` is set.
- `/models` and `/keys`, provider visibility, environment overrides, the tools menu, the profile wizard and the personal starter profiles.

### Changed

- `/studio <profile>` rewrites only `packages`, `extensions`, `enabledModels`, the default provider/model/thinking level and `defaultTools`. An enabled package keeps the entry as written, including its per-resource filters and `autoload`. A disabled package is emptied and its original entry is restored when the profile turns it back on. Rules such as `!builtin:*` and `enabledModels` are left as they are.
- `pi-profile.json` is the portable unit: one profile, its extension set and its notes. The format has no field for a key or an environment value.
- `/studio export` on the active profile takes the model from live settings, so a `/model` change is not exported stale.

### Migration

- `envOverrides`, `modelNotes` and `keyNotes` in `~/.pi/agent/profile-studio.json` are ignored. Keys that lived in `envOverrides` are no longer applied and remain in plaintext in that file. Delete the three fields and rotate any key that was stored there. See the README section "Upgrading from the earlier `profile-studio.json`".
