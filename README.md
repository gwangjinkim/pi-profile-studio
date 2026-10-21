# 🎛️ Pi Profile Studio (`pi-profile-studio`)

An interactive **Profile, Model, API Key, and Extension Switchboard** for the [Pi Coding Agent](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`) with **customizable inline notes** and per-profile visibility controls.

---

## ✨ Why `pi-profile-studio`?

Out of the box, Pi's `/model` picker shows raw model IDs and prices, and toggling extensions or scoping API keys requires manually editing `~/.pi/agent/settings.json` or running external shell wrappers.

**`pi-profile-studio`** brings everything into one interactive in-session TUI:

1. **🤖 Switch Models with Custom Notes (`/models`)**:
   - View your models alongside your own custom notes (e.g., *"Unlimited free · 1M context window · Best for repo-wide refactoring"*).
   - Edit any model's note at any time right inside the terminal UI.
   - Whitelist allowed models per profile and hide the rest (automatically syncs with Pi's `enabledModels`).
2. **🧩 Turn Extensions & Packages ON / OFF with Custom Notes (`/ext`)**:
   - View every installed Pi package (`npm:...`, `git:...`) and local extension (`~/.pi/agent/extensions/*.ts`) with your custom notes.
   - Toggle extensions ON or OFF per profile and hot-reload Pi (`/reload`) with one click—without uninstalling packages.
3. **🔑 Scope Provider API Keys & Visibility (`/keys`)**:
   - Inspect which API keys (`OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are active, set per-profile key overrides, hide unused providers, and attach custom notes to keys.
4. **🗂️ Instant Profile Switching & Creation (`/profile` or `/studio`)**:
   - Jump between completely different setups (e.g., `opencode-free`, `deepseek-operator`, `local-offline`, `audit-readonly`) in seconds.
   - Create new profiles interactively from templates or by cloning your current setup.

---

## 📦 Installation

Install directly via Pi's built-in package manager:

```bash
pi install git:github.com/gwangjinkim/pi-profile-studio
```

Or copy `extensions/profile-studio.ts` directly into your personal extensions folder:

```bash
cp extensions/profile-studio.ts ~/.pi/agent/extensions/profile-studio.ts
```

Then run `/reload` inside Pi (or start a new `pi` session).

---

## 🚀 Commands & Usage

| Command | Description |
| :--- | :--- |
| **`/profile`** or **`/studio`** | Open the main **Profile Studio** switchboard hub. |
| **`/profile <name>`** | Immediately switch to a named profile (e.g. `/profile opencode-free`). |
| **`/profile new`** | Launch the interactive **New Profile Wizard**. |
| **`/models`** | List allowed models for the active profile **with your custom notes**, switch models, or edit notes. |
| **`/models all`** | Show all models (including hidden ones) to toggle which models are allowed or hidden in the active profile. |
| **`/ext`** | List all installed packages and local extensions **with your custom notes**, toggle them ON/OFF, or edit notes. |
| **`/keys`** | View and manage provider API keys, toggle provider visibility per profile, and edit key notes. |

---

## 🖥️ Interactive TUI Preview

```text
🎛️ Pi Profile Studio — [opencode-free]
❯ 🔄 Switch Profile (Active: opencode-free — 📝 Unlimited free coding setup with full read/write/bash tools)
  🤖 Models & Notes (Current: opencode-go/longcat-2.5-preview-free)
  🧩 Extensions ON/OFF & Notes (8 active)
  🔑 API Keys & Provider Visibility
  🛠️ Built-in Tools (read, bash, edit, write, grep, find, ls)
  ✏️ Edit Active Profile's Name & Note
  ➕ Create New Profile
```

### `/models` View
```text
Models [opencode-free] — 2 shown (Select a model to switch or edit note)
❯ ★ opencode-go/longcat-2.5-preview-free (1M · Free) — 📝 Unlimited free · 1M context window · 48B/1.6T MoE reasoning model
    opencode-go/beam-free (125k · Free) — 📝 Unlimited free · Fast lightweight coding & iteration model
  👁️ Show All / Hidden Models (Manage Whitelist)
  ➕ Add Custom Model ID & Note
```

### `/ext` View
```text
Extensions [opencode-free] — 8/9 active
❯ [✅ ON ] npm:@reedchan/statusline (package) — 📝 Rich bottom TUI statusline (model, tokens, cost, git)
  [⏸️ OFF] operator-guard.ts (local) — 📝 Blocks write/edit/bash in main operator session; delegates to subagents
  [✅ ON ] npm:pi-effort (package) — 📝 Adds --effort flag and thinking effort controls
```

---

## ⚙️ Configuration File (`~/.pi/agent/profile-studio.json`)

All profiles, model notes, extension notes, and key notes are stored in a clean, human-readable JSON file at `~/.pi/agent/profile-studio.json` (or `$PI_CODING_AGENT_DIR/profile-studio.json`). You can edit everything interactively inside Pi's TUI or edit the JSON file directly.

---

## 📄 License

MIT © [Gwang Jin Kim](https://github.com/gwangjinkim)
