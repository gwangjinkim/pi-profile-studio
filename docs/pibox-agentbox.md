# Using Pi Profile Studio with pibox and agentbox

Pi Profile Studio decides *which* profile is active: the model, the allowed models, the tools, and which packages are on. `pibox` and `agentbox` decide *where* that profile runs: an isolated environment built from a manifest committed to the project.

They meet in two files and one rule.

## The rule

The repo is the truth for **what is installed and what is off**. Your host profile is the truth for **how you like the setup arranged**. API keys never enter either.

If a profile change should reach a teammate, export it. Nothing is picked up automatically from `~/.pi/agent` once the repo has been written.

## What lives where

| Piece | Where | Travels in git? |
| :--- | :--- | :--- |
| Profiles and extension notes (`/studio`, `/ext`) | `~/.pi/agent/profile-studio.json` | No, copied into the sandbox at sync |
| One exported profile plus its extension notes | `pi-profile.json` next to the manifest | Yes |
| Live on/off state, default model, enabled models | `~/.pi/agent/settings.json` | No |
| Installed sources and versions | `pibox.toml` + `pibox.lock`, `agentbox.toml` + `agentbox.lock` | Yes |
| Disabled packages (the profile's OFF set) | `pibox.lock` `disabled`, `agentbox.toml` `[agents.pi] disabled` | Yes |
| API key values | `auth.json`, OS keyring | No, never |

`profile-studio.json` is machine-local. `sync` copies it into `.pibox/env` or `.agentbox/env/pi` so your profiles are available inside the sandbox, but it is not part of the manifest.

`pi-profile.json` is the portable half: one file, one profile. `/studio export` writes it beside `pibox.toml` or `agentbox.toml` (walking up from the current directory), and `/studio import` reads it back.

## Adopting an existing project

```bash
# 1. On the host, make the profile you want active in pi
/profile deepseek-operator

# 2. Snapshot what it turned on and off into the manifest
pibox export                 # or: agentbox export

# 3. Inside pi, write the portable profile next to the manifest
/studio export

# 4. Commit and build the environment
git add pibox.toml pibox.lock pi-profile.json      # agentbox.toml agentbox.lock instead
pibox sync                                          # or: agentbox sync

# 5. Run pi in the environment
pibox run                    # or: agentbox run --agent pi
```

`pibox export` records the installed extensions and the disabled set from the active profile. `agentbox export` does the same per agent; add `--agent pi` to limit it to pi.

`/studio export` adds what the manifest does not carry: default provider and model, allowed models, tools, thinking level, and the notes for the extensions the profile lists. The format has no field for a key or an environment value, so the file is safe to commit.

## Receiving a project

```bash
git clone <repo> && cd <repo>
pibox sync                   # or: agentbox sync
pibox run                    # or: agentbox run --agent pi
```

The environment installs every recorded source at its recorded version and keeps the packages the profile disabled in their object form, so they stay off instead of switching back on.

Then, in pi, import the shared profile and activate it:

```
/studio import
/profile deepseek-operator
```

`/studio import` never overwrites: an existing profile with that name gets `-2`, `-3`, ... appended. Shared notes are merged into yours and win on the same key.

Finally bring your own credentials. Nothing secret travelled: register keys in your keyring (`skey set <provider>` for pibox, `agentbox keys` for agentbox) or let each tool read its own auth.

## Inside the sandbox

- The agent directory is the environment, not `~/.pi/agent`: pibox mounts `.pibox/env`, agentbox mounts `.agentbox/env/pi` at the pi agent directory.
- `/studio`, `/studio <name>` and `/ext` work normally. Switching a profile inside persists for that session, because it rewrites the environment's `settings.json`.
- The environment is rebuilt from scratch on every `sync`, so profile edits made inside are discarded. Manage profiles on the host, or copy the environment's `profile-studio.json` back before syncing.
- `/studio export` inside the sandbox still works: the project is the working directory, so `pi-profile.json` lands in the repo. With `--workspace git` it lands in the worktree, so commit from there.

## Keeping it honest

| Change on the host | What to re-run |
| :--- | :--- |
| Toggled an extension on or off in the active profile | `pibox export` / `agentbox export` (updates the disabled set) |
| Added a package and enabled it in `/ext` | `pibox add <source>` or `agentbox add ... --agent pi`, then `/studio export` |
| Changed the profile's model, tools or extension notes | `/studio export` |
| Changed only your local notes for this machine | nothing |

A stale repo is not silently repaired. `sync` trusts the manifest and only reads your `~/.pi/agent/settings.json` for a manifest written before the `disabled` field existed, so run the export once after upgrading and the repo owns the state from then on.

## One profile per repo

`pi-profile.json` has a fixed name, so a repo shares one profile: the one the project is meant to run. Keep your other profiles local, or use separate branches if two setups must sit side by side.

## Checking

```bash
jq '.disabled' pibox.lock                  # sources that stay off
jq '.packages' .pibox/env/settings.json    # object entries are the disabled ones
grep '^disabled' agentbox.toml             # agentbox: [agents.pi] disabled = [...]
agentbox env                               # manifest, lock, env status
```
