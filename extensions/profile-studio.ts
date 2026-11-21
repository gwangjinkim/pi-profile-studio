/**
 * Pi Profile Studio (profile-studio.ts)
 *
 * One portable Pi profile — pi-profile.json committed beside pibox.toml or agentbox.toml —
 * plus the extension on/off set that goes with it.
 *
 * Commands registered:
 *   /studio                   - switch profile, export, import
 *   /studio export [profile]  - write pi-profile.json next to the manifest
 *   /studio import [path]     - add a profile from pi-profile.json
 *   /studio <profile>         - apply a stored profile
 *   /ext                      - turn extensions on/off for the active profile
 *
 * Repository: https://github.com/gwangjinkim/pi-profile-studio
 * License: MIT
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ProfileDefinition {
	name: string;
	note: string;
	defaultProvider?: string;
	defaultModel?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	/** Models allowed in this profile ("provider/modelId"). Empty or ["*"] leaves enabledModels alone. */
	allowedModels: string[];
	/** Extension/package identifiers that are on in this profile: "pkg:<source>" or "local:<file>". */
	activeExtensions: string[];
	/** Built-in tools enabled in this profile. */
	activeTools: string[];
}

export interface StudioConfig {
	version: number;
	activeProfile: string;
	/** Notes keyed by extension/package identifier. Exported with the profile. */
	extensionNotes: Record<string, string>;
	/** Package entries emptied by a profile that turned them off, restored when it turns them back on. */
	savedPackageEntries: Record<string, unknown>;
	profiles: Record<string, ProfileDefinition>;
}

export interface DiscoveredExtension {
	id: string;
	kind: "package" | "local";
	rawSource: string;
}

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "", ".pi", "agent");
}

function getStudioConfigPath(): string {
	return path.join(getAgentDir(), "profile-studio.json");
}

function getSettingsPath(): string {
	return path.join(getAgentDir(), "settings.json");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
		}
	} catch {
		// Ignore parse errors and return fallback
	}
	return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function packageSource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry;
	if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
		return (entry as { source: string }).source;
	}
	return undefined;
}

/** Everything settings.json will load: its packages plus the local files in ~/.pi/agent/extensions. */
function discoverAllExtensions(settings: Record<string, any>): DiscoveredExtension[] {
	const results: DiscoveredExtension[] = [];
	const seen = new Set<string>();
	const rawPackages: unknown[] = Array.isArray(settings.packages) ? settings.packages : [];
	for (const pkg of rawPackages) {
		const source = packageSource(pkg);
		if (!source || source.includes("pi-profile-studio") || seen.has(source)) continue;
		seen.add(source);
		results.push({ id: `pkg:${source}`, kind: "package", rawSource: source });
	}

	const extDir = path.join(getAgentDir(), "extensions");
	if (fs.existsSync(extDir)) {
		try {
			for (const entry of fs.readdirSync(extDir, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				if (entry.name === "profile-studio.ts" || entry.name === "profile-studio.js" || entry.name === "pi-profile-studio") {
					continue;
				}
				if (entry.isFile() || entry.isSymbolicLink()) {
					if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
						results.push({ id: `local:${entry.name}`, kind: "local", rawSource: `extensions/${entry.name}` });
					}
				} else if (entry.isDirectory()) {
					results.push({ id: `local:${entry.name}`, kind: "local", rawSource: `extensions/${entry.name}` });
				}
			}
		} catch {
			// Ignore directory read errors
		}
	}
	return results;
}

/** Seed the first profile from the settings this machine already has, not from someone else's setup. */
function createInitialConfig(settings: Record<string, any>): StudioConfig {
	const enabledModels: string[] = Array.isArray(settings.enabledModels) ? settings.enabledModels : [];
	return {
		version: 2,
		activeProfile: "default",
		extensionNotes: {},
		savedPackageEntries: {},
		profiles: {
			default: {
				name: "default",
				note: "Captured from this machine's settings.json",
				defaultProvider: settings.defaultProvider,
				defaultModel: settings.defaultModel,
				thinkingLevel: settings.defaultThinkingLevel,
				allowedModels: enabledModels.length > 0 ? enabledModels : ["*"],
				activeExtensions: discoverAllExtensions(settings).map((ext) => ext.id),
				activeTools: Array.isArray(settings.defaultTools) ? settings.defaultTools : [],
			},
		},
	};
}

function loadStudioConfig(): StudioConfig {
	const cfgPath = getStudioConfigPath();
	const settings = readJsonFile<Record<string, any>>(getSettingsPath(), {});
	if (!fs.existsSync(cfgPath)) {
		const initial = createInitialConfig(settings);
		writeJsonFile(cfgPath, initial);
		return initial;
	}
	const loaded = readJsonFile<StudioConfig>(cfgPath, createInitialConfig(settings));
	loaded.extensionNotes ??= {};
	loaded.savedPackageEntries ??= {};
	loaded.profiles ??= {};
	return loaded;
}

function saveStudioConfig(cfg: StudioConfig): void {
	writeJsonFile(getStudioConfigPath(), cfg);
}

/**
 * Rewrite only the settings entries this profile owns. Everything else is left as written:
 * package object form and per-resource filters, extension rules such as !builtin:*, and enabledModels.
 */
function applyProfileToSettings(settings: Record<string, any>, cfg: StudioConfig, profile: ProfileDefinition): void {
	const allExts = discoverAllExtensions(settings);
	const active = new Set(profile.activeExtensions || []);
	const saved = (cfg.savedPackageEntries ??= {});

	// A package that is on keeps the entry the user wrote; a disabled one is emptied so it stops
	// loading, and its original entry comes back when the profile turns it on again.
	const packages: unknown[] = [];
	for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
		const source = packageSource(entry);
		if (!source) {
			packages.push(entry);
		} else if (active.has(`pkg:${source}`)) {
			packages.push(saved[source] ?? entry);
			delete saved[source];
		} else {
			saved[source] ??= entry;
			packages.push({ source, extensions: [], skills: [], prompts: [], themes: [] });
		}
	}
	if (!Array.isArray(settings.packages) && packages.length === 0) delete settings.packages;
	else settings.packages = packages;

	// Local extensions: drop only the -(extensions/<file>) rules this tool writes, then add this profile's.
	const rules: string[] = Array.isArray(settings.extensions)
		? settings.extensions.filter((rule: unknown): rule is string => typeof rule === "string")
		: [];
	const localExts = allExts.filter((ext) => ext.kind === "local");
	const ownedRules = new Set(localExts.flatMap((ext) => [`-${ext.rawSource}`, `-${path.basename(ext.rawSource)}`]));
	const kept = rules.filter((rule) => !ownedRules.has(rule));
	for (const ext of localExts) {
		if (!active.has(ext.id)) kept.push(`-${ext.rawSource}`);
	}
	if (kept.length > 0) settings.extensions = kept;
	else delete settings.extensions;

	// An explicit model list narrows enabledModels; a profile that allows all models leaves it alone.
	const scopedModels = (profile.allowedModels || []).filter((model) => model && model !== "*");
	if (scopedModels.length > 0) settings.enabledModels = scopedModels;

	if (profile.defaultProvider) settings.defaultProvider = profile.defaultProvider;
	if (profile.defaultModel) settings.defaultModel = profile.defaultModel;
	if (profile.thinkingLevel) settings.defaultThinkingLevel = profile.thinkingLevel;
	if (profile.activeTools && profile.activeTools.length > 0) settings.defaultTools = profile.activeTools;
}

/**
 * Synchronize the active profile's settings into ~/.pi/agent/settings.json
 * and apply runtime tool/model/thinking changes.
 */
async function applyProfileToRuntime(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	cfg: StudioConfig,
	profileId: string,
	options: { triggerReload?: boolean } = {},
): Promise<void> {
	const profile = cfg.profiles[profileId];
	if (!profile) return;

	cfg.activeProfile = profileId;
	const settingsPath = getSettingsPath();
	const settings = readJsonFile<Record<string, any>>(settingsPath, {});
	applyProfileToSettings(settings, cfg, profile);
	writeJsonFile(settingsPath, settings);
	saveStudioConfig(cfg);

	if (profile.activeTools && profile.activeTools.length > 0) {
		pi.setActiveTools(profile.activeTools);
	}
	if (profile.thinkingLevel) {
		pi.setThinkingLevel(profile.thinkingLevel);
	}
	if (profile.defaultProvider && profile.defaultModel) {
		const targetModel = ctx.modelRegistry.find(profile.defaultProvider, profile.defaultModel);
		if (targetModel) {
			await pi.setModel(targetModel);
		}
	}

	ctx.ui.setStatus("profile-studio", `🎛️ ${profileId}`);

	if (options.triggerReload && "reload" in ctx && typeof (ctx as ExtensionCommandContext).reload === "function") {
		await (ctx as ExtensionCommandContext).reload();
	}
}

/**
 * Shared profile file, committed next to pibox.toml / agentbox.toml.
 * The format has no field for an API key or environment value.
 */
const SIDECAR_NAME = "pi-profile.json";

interface ProfileSidecar {
	version: number;
	profile: Partial<ProfileDefinition>;
	/** Manifest-style source -> version ("npm:pi-effort": "0.1.1"). */
	extensions: Record<string, string>;
	extensionNotes?: Record<string, string>;
}

/** Directory holding pibox.toml or agentbox.toml, found the way both tools find it; else cwd. */
function findManifestDir(): string {
	let dir = process.cwd();
	while (true) {
		if (fs.existsSync(path.join(dir, "pibox.toml")) || fs.existsSync(path.join(dir, "agentbox.toml"))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return process.cwd();
		dir = parent;
	}
}

/** Same source -> version resolution pibox/agentbox use for their manifests. */
function extensionVersion(source: string): string {
	if (source.startsWith("npm:")) {
		const name = source.slice(4).replace(/@[^@/]*$/, "");
		const pkg = readJsonFile<{ version?: string }>(
			path.join(getAgentDir(), "npm", "node_modules", name, "package.json"),
			{},
		);
		return pkg.version || "unknown";
	}
	return source.startsWith("git:") ? "HEAD" : "path";
}

function sidecarExtId(source: string): string {
	return source.startsWith("extensions/") ? `local:${path.basename(source)}` : `pkg:${source}`;
}

async function exportProfile(ctx: ExtensionCommandContext, profileId?: string): Promise<void> {
	const cfg = loadStudioConfig();
	const id = profileId || cfg.activeProfile;
	const profile = cfg.profiles[id];
	if (!profile) {
		ctx.ui.notify(`No profile named '${id}'.`, "warning");
		return;
	}

	const settings = readJsonFile<Record<string, any>>(getSettingsPath(), {});
	// The active profile follows the model chosen with /model; other profiles export as stored.
	const live = id === cfg.activeProfile ? settings : {};
	const sources = new Map(discoverAllExtensions(settings).map((ext) => [ext.id, ext.rawSource]));
	const extensions: Record<string, string> = {};
	for (const extId of profile.activeExtensions || []) {
		const source = sources.get(extId);
		if (source) extensions[source] = extensionVersion(source);
	}

	const extensionNotes: Record<string, string> = {};
	for (const [extId, note] of Object.entries(cfg.extensionNotes)) {
		if ((profile.activeExtensions || []).includes(extId)) extensionNotes[extId] = note;
	}

	const sidecar: ProfileSidecar = {
		version: 1,
		profile: {
			name: profile.name,
			note: profile.note,
			defaultProvider: live.defaultProvider ?? profile.defaultProvider,
			defaultModel: live.defaultModel ?? profile.defaultModel,
			thinkingLevel: live.defaultThinkingLevel ?? profile.thinkingLevel,
			allowedModels: profile.allowedModels || [],
			activeTools: profile.activeTools || [],
		},
		extensions,
	};
	if (Object.keys(extensionNotes).length > 0) sidecar.extensionNotes = extensionNotes;

	const file = path.join(findManifestDir(), SIDECAR_NAME);
	if (fs.existsSync(file)) {
		const overwrite = await ctx.ui.confirm("Overwrite pi-profile.json?", `${file} already exists. Replace it?`);
		if (!overwrite) return;
	}
	writeJsonFile(file, sidecar);
	ctx.ui.notify(`Exported [${id}] (${Object.keys(extensions).length} extensions) to ${file}`, "info");
}

async function importProfile(ctx: ExtensionCommandContext, filePath?: string): Promise<void> {
	const file = filePath ? path.resolve(filePath) : path.join(findManifestDir(), SIDECAR_NAME);
	if (!fs.existsSync(file)) {
		ctx.ui.notify(`No ${SIDECAR_NAME} at ${file}.`, "warning");
		return;
	}
	const sidecar = readJsonFile<ProfileSidecar | null>(file, null);
	if (!sidecar || !sidecar.profile || typeof sidecar.extensions !== "object") {
		ctx.ui.notify(`${file} is not a Pi profile file.`, "error");
		return;
	}

	const cfg = loadStudioConfig();
	const base = (sidecar.profile.name || "imported")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "imported";
	let id = base;
	for (let n = 2; cfg.profiles[id]; n++) id = `${base}-${n}`;

	const p = sidecar.profile;
	cfg.profiles[id] = {
		name: p.name || id,
		note: p.note || "",
		defaultProvider: p.defaultProvider,
		defaultModel: p.defaultModel,
		thinkingLevel: p.thinkingLevel,
		allowedModels: Array.isArray(p.allowedModels) ? p.allowedModels : [],
		activeExtensions: Object.keys(sidecar.extensions).map(sidecarExtId),
		activeTools: Array.isArray(p.activeTools) ? p.activeTools : [],
	};
	Object.assign(cfg.extensionNotes, sidecar.extensionNotes || {});
	saveStudioConfig(cfg);
	ctx.ui.notify(
		`Imported profile [${id}] (${cfg.profiles[id].activeExtensions.length} extensions). Activate with /studio ${id}.`,
		"info",
	);
}

async function openExtensionsMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	let pendingReload = false;
	while (true) {
		const cfg = loadStudioConfig();
		const profile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
		const allExts = discoverAllExtensions(readJsonFile(getSettingsPath(), {}));
		const activeSet = new Set(profile.activeExtensions || []);

		const options: string[] = [];
		const extMap = new Map<string, DiscoveredExtension>();
		for (const ext of allExts) {
			const status = activeSet.has(ext.id) ? "✅ ON " : "⏸️ OFF";
			const shortName = ext.rawSource.replace(/^extensions\//, "");
			const note = cfg.extensionNotes[ext.id] || "No note (select to add)";
			const label = `[${status}] ${shortName} (${ext.kind}) — 📝 ${note}`;
			options.push(label);
			extMap.set(label, ext);
		}

		if (pendingReload) {
			options.unshift("⚡ Apply Changes & Reload Pi Runtime Now (/reload)");
		}
		options.push("✅ Enable All Extensions in Profile");
		options.push("⏸️ Disable All Optional Extensions in Profile");
		options.push("⬅️ Back / Close");

		const title = `Extensions [${cfg.activeProfile}] — ${activeSet.size}/${allExts.length} active`;
		const choice = await ctx.ui.select(title, options);
		if (!choice || choice === "⬅️ Back / Close") {
			if (pendingReload) {
				const confirmReload = await ctx.ui.confirm(
					"Reload Pi Runtime?",
					"You toggled extensions. Reload now so changes take effect?",
				);
				if (confirmReload) {
					await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile, { triggerReload: true });
				}
			}
			return;
		}

		if (choice.startsWith("⚡ Apply Changes")) {
			await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile, { triggerReload: true });
			return;
		}

		if (choice === "✅ Enable All Extensions in Profile") {
			profile.activeExtensions = allExts.map((ext) => ext.id);
			await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
			pendingReload = true;
			ctx.ui.notify("Enabled all extensions.", "info");
			continue;
		}

		if (choice === "⏸️ Disable All Optional Extensions in Profile") {
			profile.activeExtensions = [];
			await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
			pendingReload = true;
			ctx.ui.notify("Disabled all optional extensions (Profile Studio remains active).", "warning");
			continue;
		}

		const selectedExt = extMap.get(choice);
		if (!selectedExt) continue;

		const isOn = activeSet.has(selectedExt.id);
		const currentNote = cfg.extensionNotes[selectedExt.id] || "";

		const actions = [
			isOn ? `⏸️ Turn OFF ${selectedExt.rawSource}` : `✅ Turn ON ${selectedExt.rawSource}`,
			`✏️ Edit note (Current: "${currentNote || "none"}")`,
			"⚡ Toggle & Reload Immediately",
			"⬅️ Back to extension list",
		];

		const action = await ctx.ui.select(`${selectedExt.rawSource} — Actions`, actions);
		if (!action || action === "⬅️ Back to extension list") continue;

		if (action.startsWith("⏸️ Turn OFF") || action.startsWith("✅ Turn ON")) {
			if (isOn) {
				profile.activeExtensions = profile.activeExtensions.filter((id) => id !== selectedExt.id);
				ctx.ui.notify(`Disabled ${selectedExt.rawSource} in [${cfg.activeProfile}]`, "warning");
			} else {
				profile.activeExtensions.push(selectedExt.id);
				ctx.ui.notify(`Enabled ${selectedExt.rawSource} in [${cfg.activeProfile}]`, "info");
			}
			await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
			pendingReload = true;
			continue;
		}

		if (action === "⚡ Toggle & Reload Immediately") {
			if (isOn) {
				profile.activeExtensions = profile.activeExtensions.filter((id) => id !== selectedExt.id);
			} else {
				profile.activeExtensions.push(selectedExt.id);
			}
			await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile, { triggerReload: true });
			return;
		}

		if (action.startsWith("✏️ Edit note")) {
			const updated = await ctx.ui.input(`Note for ${selectedExt.rawSource}`, currentNote);
			if (updated !== undefined) {
				cfg.extensionNotes[selectedExt.id] = updated;
				saveStudioConfig(cfg);
				ctx.ui.notify(`Saved note for ${selectedExt.rawSource}`, "info");
			}
		}
	}
}

async function openMainStudioHub(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const cfg = loadStudioConfig();
		const prof = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;

		const menuItems = [
			`🔄 Switch Profile (Active: ${cfg.activeProfile} — 📝 ${prof.note})`,
			`🧩 Extensions ON/OFF & Notes (${prof.activeExtensions?.length || 0} active)`,
			"📤 Export Profile (pi-profile.json beside pibox.toml / agentbox.toml)",
			"📥 Import Profile (from pi-profile.json)",
			"❌ Close Studio",
		];

		const selected = await ctx.ui.select(`🎛️ Pi Profile Studio — [${cfg.activeProfile}]`, menuItems);
		if (!selected || selected === "❌ Close Studio") return;

		if (selected.startsWith("🔄 Switch Profile")) {
			const items = Object.keys(cfg.profiles).map((id) => {
				const p = cfg.profiles[id];
				const badge = id === cfg.activeProfile ? "★ " : "  ";
				const modelBadge = p.defaultModel ? `[${p.defaultProvider}/${p.defaultModel}]` : "";
				return `${badge}${id} ${modelBadge} — 📝 ${p.note}`;
			});
			items.push("⬅️ Back");

			const picked = await ctx.ui.select("Select Active Profile", items);
			if (!picked || picked === "⬅️ Back") continue;

			const chosenId = picked.replace(/^[★\s]+/, "").split(" ")[0].trim();
			if (cfg.profiles[chosenId]) {
				await applyProfileToRuntime(pi, ctx, cfg, chosenId);
				const reloadNow = await ctx.ui.confirm(
					`Switched to [${chosenId}]`,
					"Reload extensions now so extension ON/OFF changes take full effect?",
				);
				if (reloadNow) {
					await ctx.reload();
					return;
				}
			}
			continue;
		}

		if (selected.startsWith("🧩 Extensions")) {
			await openExtensionsMenu(pi, ctx);
			continue;
		}

		if (selected.startsWith("📤 Export Profile")) {
			await exportProfile(ctx);
			continue;
		}

		if (selected.startsWith("📥 Import Profile")) {
			await importProfile(ctx);
		}
	}
}

export default function profileStudioExtension(pi: ExtensionAPI): void {
	// OpenCode Go is only offered when this machine has its key; there is no bundled fallback.
	const opencodeKey = process.env.OPENCODE_API_KEY;
	if (opencodeKey) {
		pi.registerProvider("opencode-go", {
			name: "OpenCode Go",
			baseUrl: "https://opencode.ai/inference/go/v1",
			api: "openai-completions",
			apiKey: opencodeKey,
			headers: {
				"x-opencode-session": "default",
			},
			models: [
				{
					id: "longcat-2.5-preview-free",
					name: "LongCat 2.5 Preview (Free)",
					reasoning: true,
					input: ["text", "image"],
					contextWindow: 1000000,
					maxTokens: 4096,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
				{
					id: "beam-free",
					name: "Beam (Free)",
					reasoning: false,
					input: ["text", "image"],
					contextWindow: 128000,
					maxTokens: 4096,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		});
	}

	// Show the active profile in the statusline on session start.
	pi.on("session_start", (_event, ctx) => {
		const cfg = loadStudioConfig();
		if (cfg.profiles[cfg.activeProfile]) {
			ctx.ui.setStatus("profile-studio", `🎛️ ${cfg.activeProfile}`);
		}
	});

	const studioHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const trimmed = args.trim();
		if (trimmed === "export" || trimmed.startsWith("export ")) {
			await exportProfile(ctx, trimmed.slice(6).trim() || undefined);
			return;
		}
		if (trimmed === "import" || trimmed.startsWith("import ")) {
			await importProfile(ctx, trimmed.slice(6).trim() || undefined);
			return;
		}
		if (trimmed === "ext" || trimmed === "extensions" || trimmed === "e") {
			await openExtensionsMenu(pi, ctx);
			return;
		}
		if (trimmed) {
			const cfg = loadStudioConfig();
			if (cfg.profiles[trimmed]) {
				await applyProfileToRuntime(pi, ctx, cfg, trimmed);
				ctx.ui.notify(`Switched to profile [${trimmed}] — ${cfg.profiles[trimmed].note}`, "info");
				return;
			}
		}
		await openMainStudioHub(pi, ctx);
	};

	pi.registerCommand("profile", {
		description: "Switch to a stored profile, or open Pi Profile Studio",
		handler: studioHandler,
	});

	pi.registerCommand("studio", {
		description: "Portable profiles: switch, export to / import from pi-profile.json",
		handler: studioHandler,
	});

	pi.registerCommand("ext", {
		description: "Toggle extensions/packages on or off for the active profile",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await openExtensionsMenu(pi, ctx);
		},
	});
}
