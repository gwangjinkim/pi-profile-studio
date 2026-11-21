# Pi Profile Studio (`pi-profile-studio`)

One portable profile for the [Pi Coding Agent](https://github.com/earendil-works/pi), carried in `pi-profile.json` beside a `pibox.toml` or `agentbox.toml`, with the extension on/off set that goes with it.

---

## What it is

A manifest already says what is installed and what is disabled. It does not say which model the project runs, which models are allowed, which built-in tools are on, how much thinking, or which of the installed extensions are meant to be enabled. This extension carries exactly that: one JSON file per project, exported on the host, imported and applied on the other machine.

## Scope

**Does:** export and import one profile, apply its model, tools, allowed models and extension on/off set, and toggle extensions per profile with notes.

**Does not:** pick models (Pi's `/model` does that), store API keys (they stay in `auth.json` or your keyring), keep a profile library, or add packages (`pibox add`, `agentbox add`).

The `opencode-go` provider (LongCat 2.5 and Beam free) is registered only when `OPENCODE_API_KEY` is set. No key is bundled.

---

## Installation

Install directly via Pi's built-in package manager:

```bash
pi install git:github.com/gwangjinkim/pi-profile-studio
```

Or copy `extensions/profile-studio.ts` into your personal extensions folder:

```bash
cp extensions/profile-studio.ts ~/.pi/agent/extensions/profile-studio.ts
```

Then run `/reload` inside Pi (or start a new `pi` session).

---

## Commands

| Command | Description |
| :--- | :--- |
| **`/studio`** | Switch to a stored profile, export, or import. |
| **`/studio export [profile]`** | Write `pi-profile.json` for the active (or named) profile into the directory that holds `pibox.toml` / `agentbox.toml`. Never writes a key or environment value. |
| **`/studio import [path]`** | Add a profile from `pi-profile.json` (or an explicit path) without overwriting a profile that already has that name. |
| **`/studio <profile>`** / **`/profile <profile>`** | Apply a stored profile: model, thinking level, tools, allowed models, extension on/off. |
| **`/ext`** | List installed packages and local extensions with their notes, toggle them for the active profile, reload. |

A profile is a plain JSON object: to change the model, allowed models or tools of a profile, edit `profile-studio.json` (or apply a profile and run `/studio export`) rather than looking for a menu.

---

## Applying a profile changes only what the profile owns

`/studio <profile>` rewrites five keys of `~/.pi/agent/settings.json` and nothing else:

| Settings key | What the apply does |
| :--- | :--- |
| `packages` | An enabled package keeps the entry you wrote, including its per-resource filters and `autoload`. A disabled package becomes `{source, extensions: [], skills: [], prompts: [], themes: []}`; its original entry is saved in `profile-studio.json` and put back exactly when the profile turns it on again. A package that is not in `settings.json` is never added: the manifest installs packages. |
| `extensions` | Existing rules (`!builtin:*`, `+builtin:*`, `+<path>`, `-<path>`) are kept. Only the `-extensions/<file>` lines for the local extensions this tool knows are replaced with the profile's own. |
| `enabledModels` | Set only when the profile lists concrete models. A profile with `[]` or `["*"]` allows everything and leaves your `enabledModels` untouched. |
| `defaultProvider`, `defaultModel`, `defaultThinkingLevel` | Set from the profile. |
| `defaultTools` | Set from the profile when it lists tools. |

The disabled set is the profile's `activeExtensions` read against what is installed. Toggling in `/ext` edits that list and re-applies it, so `pibox export` / `agentbox export` can record the same set in the project manifest.

---

## `pi-profile.json`

```json
{
  "version": 1,
  "profile": {
    "name": "deepseek-operator",
    "note": "Main session plans and reads, worker subagents execute",
    "defaultProvider": "openrouter-siliconflow",
    "defaultModel": "deepseek/deepseek-v4.1-flash",
    "thinkingLevel": "high",
    "allowedModels": ["openrouter-siliconflow/deepseek/deepseek-v4.1-flash"],
    "activeTools": ["read", "grep", "find", "ls"]
  },
  "extensions": {
    "npm:pi-effort": "0.1.1",
    "extensions/operator-guard.ts": "path"
  },
  "extensionNotes": {
    "pkg:npm:pi-effort": "Adds --effort flag and thinking effort controls"
  }
}
```

- `extensions` is the manifest-style source to version map both sandbox tools already use, so the file agrees with `pibox.toml` / `agentbox.toml` about what is enabled.
- `extensionNotes` holds the notes for the extensions this profile lists only; notes for everything else stay on the machine that wrote them.
- There is no field for a key or environment value. Nothing secret can travel in this file.

---

## Using with `pibox` / `agentbox`

The walkthrough, including what travels in git, what the sandbox seeds from your host, and what to re-run after a profile change, is in [docs/pibox-agentbox.md](docs/pibox-agentbox.md).

---

## Configuration file (`~/.pi/agent/profile-studio.json`)

Holds `activeProfile`, `profiles`, `extensionNotes`, and `savedPackageEntries` (the bookkeeping that restores a package's filters when a profile turns it back on). The first run seeds one `default` profile from the settings already on the machine; nothing is seeded from someone else's setup.

---

## License

MIT © [Gwang Jin Kim](https://github.com/gwangjinkim)
