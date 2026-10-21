/**
 * Pi Profile Studio (profile-studio.ts)
 *
 * Interactive Profile, Model, API Key, and Extension Switchboard for Pi Coding Agent
 * with customizable inline notes and per-profile visibility controls.
 *
 * Commands registered:
 *   /profile (or /studio) - Open the main Profile Studio switchboard
 *   /models               - Switch models, filter allowed models, and edit model notes
 *   /ext                  - Toggle extensions/packages on/off and edit extension notes
 *   /keys                 - Manage provider API keys, visibility, and key notes
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
	/** Models allowed in this profile ("provider/modelId"). Empty or ["*"] means all allowed. */
	allowedModels: string[];
	/** Providers allowed in this profile. Empty or ["*"] means all allowed. */
	allowedProviders: string[];
	/** Active extension/package identifiers enabled in this profile. */
	activeExtensions: string[];
	/** Built-in tools enabled in this profile (read, bash, edit, write, grep, find, ls). */
	activeTools: string[];
	/** Optional per-profile environment variable / API key overrides. */
	envOverrides?: Record<string, string>;
}

export interface StudioConfig {
	version: number;
	activeProfile: string;
	/** Master catalog of known packages so toggling off in settings.json never loses them. */
	knownPackages: string[];
	/** Custom user notes keyed by "provider/modelId" or "modelId". */
	modelNotes: Record<string, string>;
	/** Custom user notes keyed by extension/package identifier. */
	extensionNotes: Record<string, string>;
	/** Custom user notes keyed by provider or env var name. */
	keyNotes: Record<string, string>;
	/** Named profiles. */
	profiles: Record<string, ProfileDefinition>;
}

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

const COMMON_API_KEYS: Array<{ envVar: string; provider: string; defaultNote: string }> = [
	{ envVar: "OPENCODE_API_KEY", provider: "opencode-go", defaultNote: "OpenCode Go API key (LongCat 2.5 Free & Beam Free)" },
	{ envVar: "OPENROUTER_API_KEY", provider: "openrouter-siliconflow", defaultNote: "OpenRouter API key (DeepSeek V4.1 Flash FP8)" },
	{ envVar: "BAI_API_KEY", provider: "bai", defaultNote: "B.AI API key" },
	{ envVar: "ANTHROPIC_API_KEY", provider: "anthropic", defaultNote: "Anthropic Claude API key" },
	{ envVar: "OPENAI_API_KEY", provider: "openai", defaultNote: "OpenAI API key" },
	{ envVar: "GEMINI_API_KEY", provider: "google", defaultNote: "Google Gemini API key" },
	{ envVar: "DEEPSEEK_API_KEY", provider: "deepseek", defaultNote: "DeepSeek official API key" },
];

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "", ".pi", "agent");
}

function getStudioConfigPath(): string {
	return path.join(getAgentDir(), "profile-studio.json");
}

function getSettingsPath(): string {
	return path.join(getAgentDir(), "settings.json");
}

function getModelsJsonPath(): string {
	return path.join(getAgentDir(), "models.json");
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

function maskSecret(val: string | undefined): string {
	if (!val) return "unset";
	if (val.length <= 10) return "***";
	return `${val.slice(0, 6)}…${val.slice(-4)}`;
}

/**
 * Discover all local extensions in ~/.pi/agent/extensions (excluding profile-studio itself)
 * and all packages from settings.json + knownPackages.
 */
function discoverAllExtensions(cfg: StudioConfig): Array<{ id: string; kind: "package" | "local"; rawSource: string }> {
	const agentDir = getAgentDir();
	const settings = readJsonFile<Record<string, any>>(getSettingsPath(), {});
	const rawPackages: any[] = Array.isArray(settings.packages) ? settings.packages : [];

	const packageSources = new Set<string>(cfg.knownPackages || []);
	for (const pkg of rawPackages) {
		if (typeof pkg === "string") {
			packageSources.add(pkg);
		} else if (pkg && typeof pkg === "object" && typeof pkg.source === "string") {
			packageSources.add(pkg.source);
		}
	}

	const results: Array<{ id: string; kind: "package" | "local"; rawSource: string }> = [];
	for (const src of packageSources) {
		if (src.includes("pi-profile-studio")) continue;
		results.push({ id: `pkg:${src}`, kind: "package", rawSource: src });
	}

	const extDir = path.join(agentDir, "extensions");
	if (fs.existsSync(extDir)) {
		try {
			const entries = fs.readdirSync(extDir, { withFileTypes: true });
			for (const entry of entries) {
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

function createInitialConfig(): StudioConfig {
	const settings = readJsonFile<Record<string, any>>(getSettingsPath(), {});
	const rawPackages: any[] = Array.isArray(settings.packages) ? settings.packages : [];
	const knownPackages: string[] = [];
	for (const pkg of rawPackages) {
		if (typeof pkg === "string") knownPackages.push(pkg);
		else if (pkg && typeof pkg === "object" && typeof pkg.source === "string") knownPackages.push(pkg.source);
	}

	const tempCfg: StudioConfig = {
		version: 1,
		activeProfile: "default",
		knownPackages,
		modelNotes: {
			"opencode-go/longcat-2.5-preview-free": "Unlimited free · 1M context window · 48B/1.6T MoE reasoning model",
			"opencode-go/beam-free": "Unlimited free · Fast lightweight coding & iteration model",
			"openrouter-siliconflow/deepseek/deepseek-v4.1-flash": "Primary daily driver via OpenRouter (SiliconFlow FP8, 1M ctx)",
			"local-qwen/unsloth/Qwen3.6-27B-GGUF:Q4_K_M": "Local offline llama.cpp server (65k ctx, zero cost)",
			"bai/deepseek-v4-flash": "DeepSeek V4.1 Flash via B.AI API",
		},
		extensionNotes: {
			"pkg:npm:@dreki-gg/pi-context7": "Context7 documentation lookup & library docs fetcher",
			"pkg:npm:better-custom-provider": "Enhanced custom provider configuration helper",
			"pkg:npm:pi-llama-cpp": "Interactive /llama manager for local llama.cpp models",
			"pkg:npm:@xamfoo/pi-openrouter-pin": "Pins OpenRouter requests to specific hardware providers",
			"pkg:git:github.com/kslamph/multikey@v1.2.0": "Rotates and manages multiple provider API keys",
			"pkg:npm:@fleetagent/pi-coding-agent": "Fleet multi-agent orchestration for Pi",
			"pkg:npm:pi-effort": "Adds --effort flag and thinking effort controls",
			"pkg:/Users/josephus/.pi/agent/local/pi-deepseek-v4-anchor": "Anchors tool formats specifically for DeepSeek V4 Flash",
			"pkg:npm:@reedchan/statusline": "Rich bottom TUI statusline (model, tokens, cost, git)",
			"local:operator-guard.ts": "Blocks write/edit/bash in main operator session; delegates to subagents",
			"local:openrouter.ts": "Fetches live model catalog from OpenRouter API",
			"local:context7": "Local Context7 integration plugin",
			"local:subagent": "Subagent worker delegation tool",
		},
		keyNotes: {
			OPENCODE_API_KEY: "OpenCode Go free tier & subscription key (LongCat 2.5 + Beam)",
			OPENROUTER_API_KEY: "OpenRouter production key for DeepSeek V4.1 Flash",
			BAI_API_KEY: "B.AI inference key",
		},
		profiles: {},
	};

	const allExts = discoverAllExtensions(tempCfg).map((e) => e.id);
	const currentExts = allExts.filter((id) => !id.endsWith("operator-guard.ts"));

	tempCfg.profiles = {
		default: {
			name: "Default (All Models & Current Setup)",
			note: "Your current setup with DeepSeek V4.1 Flash, OpenCode Go, and standard extensions",
			defaultProvider: settings.defaultProvider || "openrouter-siliconflow",
			defaultModel: settings.defaultModel || "deepseek/deepseek-v4.1-flash",
			thinkingLevel: "medium",
			allowedModels: ["*"],
			allowedProviders: ["*"],
			activeExtensions: allExts,
			activeTools: Array.isArray(settings.defaultTools) ? settings.defaultTools : ["read", "grep", "find", "ls"],
		},
		"opencode-free": {
			name: "OpenCode Go (LongCat 2.5 & Beam Free)",
			note: "Unlimited free coding setup with full read/write/bash tools and operator-guard disabled",
			defaultProvider: "opencode-go",
			defaultModel: "longcat-2.5-preview-free",
			thinkingLevel: "low",
			allowedModels: [
				"opencode-go/longcat-2.5-preview-free",
				"opencode-go/beam-free",
			],
			allowedProviders: ["opencode-go"],
			activeExtensions: currentExts,
			activeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		},
		"deepseek-operator": {
			name: "DeepSeek Operator (Read-Only Main + Subagents)",
			note: "Strict operator workflow: main session plans & reads, worker subagents execute changes",
			defaultProvider: "openrouter-siliconflow",
			defaultModel: "deepseek/deepseek-v4.1-flash",
			thinkingLevel: "high",
			allowedModels: [
				"openrouter-siliconflow/deepseek/deepseek-v4.1-flash",
				"bai/deepseek-v4-flash",
			],
			allowedProviders: ["openrouter-siliconflow", "bai"],
			activeExtensions: allExts,
			activeTools: ["read", "grep", "find", "ls"],
		},
		"local-offline": {
			name: "Local Qwen 3.6 (Offline / Private)",
			note: "100% local inference via llama.cpp on port 8080 with full coding tools",
			defaultProvider: "local-qwen",
			defaultModel: "unsloth/Qwen3.6-27B-GGUF:Q4_K_M",
			thinkingLevel: "medium",
			allowedModels: ["local-qwen/unsloth/Qwen3.6-27B-GGUF:Q4_K_M"],
			allowedProviders: ["local-qwen"],
			activeExtensions: currentExts,
			activeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		},
	};

	return tempCfg;
}

function loadStudioConfig(): StudioConfig {
	const cfgPath = getStudioConfigPath();
	if (!fs.existsSync(cfgPath)) {
		const initial = createInitialConfig();
		writeJsonFile(cfgPath, initial);
		return initial;
	}
	const loaded = readJsonFile<StudioConfig>(cfgPath, createInitialConfig());
	// Sync any newly added packages from settings.json into knownPackages
	const settings = readJsonFile<Record<string, any>>(getSettingsPath(), {});
	if (Array.isArray(settings.packages)) {
		const known = new Set(loaded.knownPackages || []);
		for (const pkg of settings.packages) {
			if (typeof pkg === "string") known.add(pkg);
			else if (pkg && typeof pkg === "object" && typeof pkg.source === "string") known.add(pkg.source);
		}
		loaded.knownPackages = Array.from(known);
	}
	return loaded;
}

function saveStudioConfig(cfg: StudioConfig): void {
	writeJsonFile(getStudioConfigPath(), cfg);
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
	saveStudioConfig(cfg);

	// 1. Apply environment variable overrides if present
	if (profile.envOverrides) {
		for (const [k, v] of Object.entries(profile.envOverrides)) {
			if (v) process.env[k] = v;
		}
	}

	// 2. Update settings.json for persistence & extension loading
	const settingsPath = getSettingsPath();
	const settings = readJsonFile<Record<string, any>>(settingsPath, {});

	if (profile.defaultProvider) settings.defaultProvider = profile.defaultProvider;
	if (profile.defaultModel) settings.defaultModel = profile.defaultModel;
	if (profile.thinkingLevel) settings.defaultThinkingLevel = profile.thinkingLevel;
	if (profile.activeTools && profile.activeTools.length > 0) {
		settings.defaultTools = profile.activeTools;
	}

	// Scoped models (enabledModels)
	if (profile.allowedModels && profile.allowedModels.length > 0 && !profile.allowedModels.includes("*")) {
		settings.enabledModels = profile.allowedModels;
	} else {
		delete settings.enabledModels;
	}

	// Extensions & Packages activation
	const allExts = discoverAllExtensions(cfg);
	const activeSet = new Set(profile.activeExtensions || []);

	// Build packages array: enabled packages load normally; disabled packages have empty resource arrays
	const updatedPackages: any[] = [];
	for (const ext of allExts) {
		if (ext.kind === "package") {
			if (activeSet.has(ext.id)) {
				updatedPackages.push(ext.rawSource);
			} else {
				updatedPackages.push({
					source: ext.rawSource,
					extensions: [],
					skills: [],
					prompts: [],
					themes: [],
				});
			}
		}
	}
	settings.packages = updatedPackages;

	// Build extensions exclusions for local extensions in ~/.pi/agent/extensions
	const extRules: string[] = [];
	for (const ext of allExts) {
		if (ext.kind === "local") {
			if (!activeSet.has(ext.id)) {
				extRules.push(`-${ext.rawSource}`);
			}
		}
	}
	// If operator-guard.ts is disabled, also set PI_OPERATOR=0 so even before reload it is bypassed
	if (!activeSet.has("local:operator-guard.ts")) {
		process.env.PI_OPERATOR = "0";
	} else {
		delete process.env.PI_OPERATOR;
	}

	if (extRules.length > 0) {
		settings.extensions = extRules;
	} else {
		delete settings.extensions;
	}

	writeJsonFile(settingsPath, settings);

	// 3. Apply immediate runtime changes (tools, thinking level, model, status bar)
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
 * Collect all models from ModelRegistry + models.json so nothing is missed.
 */
function getAllKnownModels(ctx: ExtensionContext, cfg: StudioConfig): Array<{
	fullId: string;
	provider: string;
	modelId: string;
	name: string;
	contextWindow: number;
	costSummary: string;
	hasAuth: boolean;
}> {
	const map = new Map<string, {
		fullId: string;
		provider: string;
		modelId: string;
		name: string;
		contextWindow: number;
		costSummary: string;
		hasAuth: boolean;
	}>();

	// 1. From live ModelRegistry
	try {
		const registered = ctx.modelRegistry.getAll();
		for (const m of registered) {
			const fullId = `${m.provider}/${m.id}`;
			const inCost = m.cost?.input ?? 0;
			const outCost = m.cost?.output ?? 0;
			const costSummary = inCost === 0 && outCost === 0 ? "Free" : `$${inCost}/$${outCost}`;
			map.set(fullId, {
				fullId,
				provider: m.provider,
				modelId: m.id,
				name: m.name || m.id,
				contextWindow: m.contextWindow || 128000,
				costSummary,
				hasAuth: ctx.modelRegistry.hasConfiguredAuth(m),
			});
		}
	} catch {
		// Ignore registry errors
	}

	// 2. From models.json directly (in case a provider isn't loaded yet)
	const modelsJson = readJsonFile<Record<string, any>>(getModelsJsonPath(), {});
	if (modelsJson.providers && typeof modelsJson.providers === "object") {
		for (const [provName, provObj] of Object.entries<any>(modelsJson.providers)) {
			if (Array.isArray(provObj?.models)) {
				for (const m of provObj.models) {
					const fullId = `${provName}/${m.id}`;
					if (!map.has(fullId)) {
						const inCost = m.cost?.input ?? 0;
						const outCost = m.cost?.output ?? 0;
						map.set(fullId, {
							fullId,
							provider: provName,
							modelId: m.id,
							name: m.name || m.id,
							contextWindow: m.contextWindow || 128000,
							costSummary: inCost === 0 && outCost === 0 ? "Free" : `$${inCost}/$${outCost}`,
							hasAuth: true,
						});
					}
				}
			}
		}
	}

	// 3. Ensure any model with a custom note is also listed
	for (const notedModel of Object.keys(cfg.modelNotes)) {
		if (!map.has(notedModel) && notedModel.includes("/")) {
			const [prov, ...rest] = notedModel.split("/");
			const mId = rest.join("/");
			map.set(notedModel, {
				fullId: notedModel,
				provider: prov,
				modelId: mId,
				name: mId,
				contextWindow: 128000,
				costSummary: "Custom",
				hasAuth: true,
			});
		}
	}

	return Array.from(map.values());
}

export default function profileStudioExtension(pi: ExtensionAPI): void {
	// Ensure OpenCode Go free models are always registered and available
	pi.registerProvider("opencode-go", {
		name: "OpenCode Go",
		baseUrl: "https://opencode.ai/inference/go/v1",
		api: "openai-completions",
		apiKey: process.env.OPENCODE_API_KEY || "oc_sk_cb215c402a23_HHQ7rnpnfH1RKxVIkUgMSbEFAOubNVAV",
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

	// Show active profile badge in statusline on session start
	pi.on("session_start", (_event, ctx) => {
		const cfg = loadStudioConfig();
		const activeProf = cfg.profiles[cfg.activeProfile];
		if (activeProf) {
			if (!activeProf.activeExtensions.includes("local:operator-guard.ts")) {
				process.env.PI_OPERATOR = "0";
			}
			ctx.ui.setStatus("profile-studio", `🎛️ ${cfg.activeProfile}`);
		}
	});

	// =========================================================================
	// INTERACTIVE MENUS
	// =========================================================================

	async function openModelsMenu(ctx: ExtensionCommandContext, showHidden = false): Promise<void> {
		while (true) {
			const cfg = loadStudioConfig();
			const profile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
			const allModels = getAllKnownModels(ctx, cfg);
			const activeFullId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : `${profile.defaultProvider}/${profile.defaultModel}`;

			const allowAllModels = !profile.allowedModels || profile.allowedModels.length === 0 || profile.allowedModels.includes("*");
			const allowAllProviders = !profile.allowedProviders || profile.allowedProviders.length === 0 || profile.allowedProviders.includes("*");

			const visibleModels = allModels.filter((m) => {
				if (showHidden) return true;
				const modelAllowed = allowAllModels || profile.allowedModels.includes(m.fullId) || profile.allowedModels.includes(m.modelId);
				const providerAllowed = allowAllProviders || profile.allowedProviders.includes(m.provider);
				return modelAllowed && providerAllowed;
			});

			const options: string[] = [];
			const optionMap = new Map<string, typeof allModels[0]>();

			for (const m of visibleModels) {
				const isCurrent = m.fullId === activeFullId ? "★ " : "  ";
				const isAllowed =
					(allowAllModels || profile.allowedModels.includes(m.fullId)) &&
					(allowAllProviders || profile.allowedProviders.includes(m.provider));
				const visBadge = showHidden ? (isAllowed ? "[✅ Allowed] " : "[🚫 Hidden] ") : "";
				const ctxK = m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(0)}M` : `${Math.round(m.contextWindow / 1024)}k`;
				const note = cfg.modelNotes[m.fullId] || cfg.modelNotes[m.modelId] || "No note (select to add)";
				const label = `${isCurrent}${visBadge}${m.fullId} (${ctxK} · ${m.costSummary}) — 📝 ${note}`;
				options.push(label);
				optionMap.set(label, m);
			}

			options.push(showHidden ? "🔽 Filter to Profile's Allowed Models Only" : "👁️ Show All / Hidden Models (Manage Whitelist)");
			options.push("➕ Add Custom Model ID & Note");
			options.push("⬅️ Back / Close");

			const title = `Models [${cfg.activeProfile}] — ${visibleModels.length} shown (Select a model to switch or edit note)`;
			const choice = await ctx.ui.select(title, options);
			if (!choice || choice === "⬅️ Back / Close") return;

			if (choice.startsWith("👁️ Show All") || choice.startsWith("🔽 Filter to")) {
				showHidden = !showHidden;
				continue;
			}

			if (choice === "➕ Add Custom Model ID & Note") {
				const newId = await ctx.ui.input("Enter provider/modelId", "e.g. opencode-go/longcat-2.5-preview-free");
				if (!newId) continue;
				const newNote = await ctx.ui.input(`Custom note for ${newId}`, "Fast free model for...");
				if (newNote !== undefined) {
					cfg.modelNotes[newId.trim()] = newNote;
					if (!allowAllModels && !profile.allowedModels.includes(newId.trim())) {
						profile.allowedModels.push(newId.trim());
					}
					saveStudioConfig(cfg);
					ctx.ui.notify(`Added ${newId.trim()} with note.`, "info");
				}
				continue;
			}

			const selectedModel = optionMap.get(choice);
			if (!selectedModel) continue;

			const currentNote = cfg.modelNotes[selectedModel.fullId] || cfg.modelNotes[selectedModel.modelId] || "";
			const isCurrentlyAllowed =
				(allowAllModels || profile.allowedModels.includes(selectedModel.fullId)) &&
				(allowAllProviders || profile.allowedProviders.includes(selectedModel.provider));

			const actions = [
				`🚀 Switch to ${selectedModel.fullId} now`,
				`✏️ Edit note (Current: "${currentNote || "none"}")`,
				isCurrentlyAllowed
					? `🚫 Hide ${selectedModel.fullId} in profile [${cfg.activeProfile}]`
					: `✅ Allow ${selectedModel.fullId} in profile [${cfg.activeProfile}]`,
				`📌 Set as default startup model for profile [${cfg.activeProfile}]`,
				"⬅️ Back to model list",
			];

			const action = await ctx.ui.select(`${selectedModel.fullId} — Actions`, actions);
			if (!action || action === "⬅️ Back to model list") continue;

			if (action.startsWith("🚀 Switch to")) {
				const found = ctx.modelRegistry.find(selectedModel.provider, selectedModel.modelId);
				if (found) {
					const ok = await pi.setModel(found);
					if (ok) {
						profile.defaultProvider = selectedModel.provider;
						profile.defaultModel = selectedModel.modelId;
						saveStudioConfig(cfg);
						ctx.ui.notify(`Switched active model to ${selectedModel.fullId}`, "info");
					} else {
						ctx.ui.notify(`Missing API key/auth for ${selectedModel.provider}. Check /keys`, "warning");
					}
				} else {
					profile.defaultProvider = selectedModel.provider;
					profile.defaultModel = selectedModel.modelId;
					await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
					ctx.ui.notify(`Set model to ${selectedModel.fullId}`, "info");
				}
				return;
			}

			if (action.startsWith("✏️ Edit note")) {
				const updated = await ctx.ui.input(`Note for ${selectedModel.fullId}`, currentNote);
				if (updated !== undefined) {
					cfg.modelNotes[selectedModel.fullId] = updated;
					saveStudioConfig(cfg);
					ctx.ui.notify(`Saved note for ${selectedModel.fullId}`, "info");
				}
				continue;
			}

			if (action.startsWith("🚫 Hide") || action.startsWith("✅ Allow")) {
				if (allowAllModels) {
					// Materialize explicit list first
					profile.allowedModels = allModels.map((m) => m.fullId);
				}
				if (isCurrentlyAllowed) {
					profile.allowedModels = profile.allowedModels.filter(
						(id) => id !== selectedModel.fullId && id !== selectedModel.modelId,
					);
					ctx.ui.notify(`Hidden ${selectedModel.fullId} in profile ${cfg.activeProfile}`, "info");
				} else {
					if (!profile.allowedModels.includes(selectedModel.fullId)) {
						profile.allowedModels.push(selectedModel.fullId);
					}
					if (!allowAllProviders && !profile.allowedProviders.includes(selectedModel.provider)) {
						profile.allowedProviders.push(selectedModel.provider);
					}
					ctx.ui.notify(`Allowed ${selectedModel.fullId} in profile ${cfg.activeProfile}`, "info");
				}
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
				continue;
			}

			if (action.startsWith("📌 Set as default")) {
				profile.defaultProvider = selectedModel.provider;
				profile.defaultModel = selectedModel.modelId;
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
				ctx.ui.notify(`${selectedModel.fullId} is now default for [${cfg.activeProfile}]`, "info");
			}
		}
	}

	async function openExtensionsMenu(ctx: ExtensionCommandContext): Promise<void> {
		let pendingReload = false;
		while (true) {
			const cfg = loadStudioConfig();
			const profile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
			const allExts = discoverAllExtensions(cfg);
			const activeSet = new Set(profile.activeExtensions || []);

			const options: string[] = [];
			const extMap = new Map<string, typeof allExts[0]>();

			for (const ext of allExts) {
				const isOn = activeSet.has(ext.id);
				const status = isOn ? "✅ ON " : "⏸️ OFF";
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
				profile.activeExtensions = allExts.map((e) => e.id);
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
				`⚡ Toggle & Reload Immediately`,
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

	async function openKeysMenu(ctx: ExtensionCommandContext): Promise<void> {
		while (true) {
			const cfg = loadStudioConfig();
			const profile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
			const allowAllProviders =
				!profile.allowedProviders ||
				profile.allowedProviders.length === 0 ||
				profile.allowedProviders.includes("*");

			const options: string[] = [];
			const keyMap = new Map<string, { envVar: string; provider: string }>();

			for (const item of COMMON_API_KEYS) {
				const overrideVal = profile.envOverrides?.[item.envVar];
				const effectiveVal = overrideVal || process.env[item.envVar];
				const keyStatus = effectiveVal ? `🟢 ${maskSecret(effectiveVal)}` : "⚪ unset";
				const providerAllowed = allowAllProviders || profile.allowedProviders.includes(item.provider);
				const visBadge = providerAllowed ? "✅ Allowed" : "🚫 Hidden ";
				const note = cfg.keyNotes[item.envVar] || item.defaultNote;
				const label = `[${visBadge}] ${item.envVar} (${item.provider}: ${keyStatus}) — 📝 ${note}`;
				options.push(label);
				keyMap.set(label, { envVar: item.envVar, provider: item.provider });
			}

			options.push("➕ Add Custom API Key / Env Variable to Profile");
			options.push("⬅️ Back / Close");

			const choice = await ctx.ui.select(`API Keys & Providers [${cfg.activeProfile}]`, options);
			if (!choice || choice === "⬅️ Back / Close") return;

			if (choice === "➕ Add Custom API Key / Env Variable to Profile") {
				const envName = await ctx.ui.input("Environment Variable Name", "e.g. CUSTOM_LLM_API_KEY");
				if (!envName) continue;
				const envVal = await ctx.ui.input(`Value for ${envName.trim()}`, "sk-...");
				const note = await ctx.ui.input(`Note for ${envName.trim()}`, "API key for...");
				if (envVal) {
					profile.envOverrides = profile.envOverrides || {};
					profile.envOverrides[envName.trim()] = envVal.trim();
					process.env[envName.trim()] = envVal.trim();
				}
				if (note !== undefined) {
					cfg.keyNotes[envName.trim()] = note;
				}
				saveStudioConfig(cfg);
				ctx.ui.notify(`Configured ${envName.trim()} in profile [${cfg.activeProfile}]`, "info");
				continue;
			}

			const selected = keyMap.get(choice);
			if (!selected) continue;

			const providerAllowed = allowAllProviders || profile.allowedProviders.includes(selected.provider);
			const currentNote = cfg.keyNotes[selected.envVar] || "";

			const actions = [
				providerAllowed
					? `🚫 Hide provider '${selected.provider}' in profile [${cfg.activeProfile}]`
					: `✅ Allow provider '${selected.provider}' in profile [${cfg.activeProfile}]`,
				`🔑 Set / Override ${selected.envVar} value for profile [${cfg.activeProfile}]`,
				`✏️ Edit note for ${selected.envVar}`,
				"⬅️ Back",
			];

			const action = await ctx.ui.select(`${selected.envVar} (${selected.provider})`, actions);
			if (!action || action === "⬅️ Back") continue;

			if (action.startsWith("🚫 Hide") || action.startsWith("✅ Allow")) {
				if (allowAllProviders) {
					profile.allowedProviders = COMMON_API_KEYS.map((k) => k.provider).concat(["local-qwen"]);
				}
				if (providerAllowed) {
					profile.allowedProviders = profile.allowedProviders.filter((p) => p !== selected.provider);
					ctx.ui.notify(`Hidden provider ${selected.provider} in [${cfg.activeProfile}]`, "warning");
				} else {
					if (!profile.allowedProviders.includes(selected.provider)) {
						profile.allowedProviders.push(selected.provider);
					}
					ctx.ui.notify(`Allowed provider ${selected.provider} in [${cfg.activeProfile}]`, "info");
				}
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
				continue;
			}

			if (action.startsWith("🔑 Set")) {
				const newVal = await ctx.ui.input(`Enter API key for ${selected.envVar} (leave empty to clear override)`, "");
				if (newVal !== undefined) {
					profile.envOverrides = profile.envOverrides || {};
					if (newVal.trim() === "") {
						delete profile.envOverrides[selected.envVar];
						ctx.ui.notify(`Cleared profile override for ${selected.envVar}`, "info");
					} else {
						profile.envOverrides[selected.envVar] = newVal.trim();
						process.env[selected.envVar] = newVal.trim();
						ctx.ui.notify(`Updated ${selected.envVar} for profile [${cfg.activeProfile}]`, "info");
					}
					saveStudioConfig(cfg);
				}
				continue;
			}

			if (action.startsWith("✏️ Edit note")) {
				const updated = await ctx.ui.input(`Note for ${selected.envVar}`, currentNote);
				if (updated !== undefined) {
					cfg.keyNotes[selected.envVar] = updated;
					saveStudioConfig(cfg);
					ctx.ui.notify(`Saved note for ${selected.envVar}`, "info");
				}
			}
		}
	}

	async function openToolsMenu(ctx: ExtensionCommandContext): Promise<void> {
		while (true) {
			const cfg = loadStudioConfig();
			const profile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
			const activeTools = new Set(profile.activeTools || BUILTIN_TOOLS);

			const options = BUILTIN_TOOLS.map((t) => {
				const status = activeTools.has(t) ? "✅ ON " : "⏸️ OFF";
				return `[${status}] ${t}`;
			});
			options.push("🔓 Enable All Built-in Tools (Full Coding Mode)");
			options.push("🔒 Read-Only Tools Only (read, grep, find, ls)");
			options.push("⬅️ Back");

			const choice = await ctx.ui.select(`Built-in Tools [${cfg.activeProfile}]`, options);
			if (!choice || choice === "⬅️ Back") return;

			if (choice.startsWith("🔓 Enable All")) {
				profile.activeTools = [...BUILTIN_TOOLS];
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
				ctx.ui.notify("Enabled all built-in tools.", "info");
				continue;
			}

			if (choice.startsWith("🔒 Read-Only")) {
				profile.activeTools = ["read", "grep", "find", "ls"];
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
				ctx.ui.notify("Switched to read-only tools.", "info");
				continue;
			}

			const toolName = choice.split("] ")[1]?.trim();
			if (toolName) {
				if (activeTools.has(toolName)) {
					profile.activeTools = profile.activeTools.filter((t) => t !== toolName);
				} else {
					profile.activeTools.push(toolName);
				}
				await applyProfileToRuntime(pi, ctx, cfg, cfg.activeProfile);
			}
		}
	}

	async function createNewProfileWizard(ctx: ExtensionCommandContext): Promise<void> {
		const cfg = loadStudioConfig();
		const currentProfile = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;

		const rawId = await ctx.ui.input("New Profile ID (short slug)", "e.g. fast-prototyping");
		if (!rawId) return;
		const profileId = rawId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
		if (!profileId) return;

		const displayName = (await ctx.ui.input("Profile Display Name", profileId)) || profileId;
		const note = (await ctx.ui.input("Profile Info / Note (displayed in switcher)", "Custom workflow for...")) || "Custom profile";

		const templateChoice = await ctx.ui.select("Start from template:", [
			`📋 Clone current profile (${cfg.activeProfile})`,
			"🆓 OpenCode Free Models (LongCat 2.5 + Beam, all tools)",
			"🔍 Read-Only Audit Mode (read, grep, find, ls)",
			"🌐 All Models & All Extensions Enabled",
		]);
		if (!templateChoice) return;

		const allExts = discoverAllExtensions(cfg).map((e) => e.id);
		let newProf: ProfileDefinition;

		if (templateChoice.startsWith("🆓 OpenCode")) {
			newProf = {
				name: displayName,
				note,
				defaultProvider: "opencode-go",
				defaultModel: "longcat-2.5-preview-free",
				thinkingLevel: "low",
				allowedModels: ["opencode-go/longcat-2.5-preview-free", "opencode-go/beam-free"],
				allowedProviders: ["opencode-go"],
				activeExtensions: allExts.filter((id) => !id.endsWith("operator-guard.ts")),
				activeTools: [...BUILTIN_TOOLS],
			};
		} else if (templateChoice.startsWith("🔍 Read-Only")) {
			newProf = {
				name: displayName,
				note,
				defaultProvider: currentProfile.defaultProvider,
				defaultModel: currentProfile.defaultModel,
				thinkingLevel: "medium",
				allowedModels: [...currentProfile.allowedModels],
				allowedProviders: [...currentProfile.allowedProviders],
				activeExtensions: [...currentProfile.activeExtensions],
				activeTools: ["read", "grep", "find", "ls"],
			};
		} else if (templateChoice.startsWith("🌐 All Models")) {
			newProf = {
				name: displayName,
				note,
				defaultProvider: currentProfile.defaultProvider,
				defaultModel: currentProfile.defaultModel,
				thinkingLevel: "medium",
				allowedModels: ["*"],
				allowedProviders: ["*"],
				activeExtensions: allExts,
				activeTools: [...BUILTIN_TOOLS],
			};
		} else {
			newProf = JSON.parse(JSON.stringify(currentProfile));
			newProf.name = displayName;
			newProf.note = note;
		}

		cfg.profiles[profileId] = newProf;
		await applyProfileToRuntime(pi, ctx, cfg, profileId);
		ctx.ui.notify(`Created and activated profile [${profileId}]! Now customize its models or extensions.`, "info");
	}

	async function openMainStudioHub(ctx: ExtensionCommandContext): Promise<void> {
		while (true) {
			const cfg = loadStudioConfig();
			const prof = cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
			const activeModelStr = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : `${prof.defaultProvider}/${prof.defaultModel}`;

			const menuItems = [
				`🔄 Switch Profile (Active: ${cfg.activeProfile} — 📝 ${prof.note})`,
				`🤖 Models & Notes (Current: ${activeModelStr})`,
				`🧩 Extensions ON/OFF & Notes (${prof.activeExtensions?.length || 0} active)`,
				`🔑 API Keys & Provider Visibility`,
				`🛠️ Built-in Tools (${prof.activeTools?.join(", ") || "all"})`,
				`✏️ Edit Active Profile's Name & Note`,
				`➕ Create New Profile`,
				`🗑️ Delete a Profile`,
				`❌ Close Studio`,
			];

			const selected = await ctx.ui.select(`🎛️ Pi Profile Studio — [${cfg.activeProfile}]`, menuItems);
			if (!selected || selected === "❌ Close Studio") return;

			if (selected.startsWith("🔄 Switch Profile")) {
				const profileIds = Object.keys(cfg.profiles);
				const items = profileIds.map((id) => {
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

			if (selected.startsWith("🤖 Models")) {
				await openModelsMenu(ctx, false);
				continue;
			}

			if (selected.startsWith("🧩 Extensions")) {
				await openExtensionsMenu(ctx);
				continue;
			}

			if (selected.startsWith("🔑 API Keys")) {
				await openKeysMenu(ctx);
				continue;
			}

			if (selected.startsWith("🛠️ Built-in Tools")) {
				await openToolsMenu(ctx);
				continue;
			}

			if (selected.startsWith("✏️ Edit Active Profile")) {
				const newName = await ctx.ui.input(`Display Name for [${cfg.activeProfile}]`, prof.name);
				if (newName !== undefined && newName.trim()) prof.name = newName.trim();
				const newNote = await ctx.ui.input(`Info Note for [${cfg.activeProfile}]`, prof.note);
				if (newNote !== undefined) prof.note = newNote;
				saveStudioConfig(cfg);
				ctx.ui.notify(`Updated info for [${cfg.activeProfile}]`, "info");
				continue;
			}

			if (selected.startsWith("➕ Create New Profile")) {
				await createNewProfileWizard(ctx);
				continue;
			}

			if (selected.startsWith("🗑️ Delete a Profile")) {
				const deletable = Object.keys(cfg.profiles).filter((id) => id !== "default" && id !== cfg.activeProfile);
				if (deletable.length === 0) {
					ctx.ui.notify("No inactive custom profiles to delete.", "warning");
					continue;
				}
				const toDelete = await ctx.ui.select("Select profile to delete", [...deletable, "⬅️ Cancel"]);
				if (toDelete && toDelete !== "⬅️ Cancel") {
					const ok = await ctx.ui.confirm("Delete Profile", `Delete profile '${toDelete}' permanently?`);
					if (ok) {
						delete cfg.profiles[toDelete];
						saveStudioConfig(cfg);
						ctx.ui.notify(`Deleted profile '${toDelete}'.`, "info");
					}
				}
			}
		}
	}

	// =========================================================================
	// SLASH COMMAND REGISTRATIONS
	// =========================================================================

	const studioHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const trimmed = args.trim();
		if (trimmed === "models" || trimmed === "m") {
			await openModelsMenu(ctx, false);
			return;
		}
		if (trimmed === "ext" || trimmed === "extensions" || trimmed === "e") {
			await openExtensionsMenu(ctx);
			return;
		}
		if (trimmed === "keys" || trimmed === "k") {
			await openKeysMenu(ctx);
			return;
		}
		if (trimmed === "new") {
			await createNewProfileWizard(ctx);
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
		await openMainStudioHub(ctx);
	};

	pi.registerCommand("profile", {
		description: "Open Pi Profile Studio (switch profiles, models, keys, extensions & edit notes)",
		handler: studioHandler,
	});

	pi.registerCommand("studio", {
		description: "Open Pi Profile Studio switchboard",
		handler: studioHandler,
	});

	pi.registerCommand("models", {
		description: "List allowed models with custom editable notes & switch models",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await openModelsMenu(ctx, args.trim() === "all");
		},
	});

	pi.registerCommand("ext", {
		description: "Toggle extensions/packages on or off with custom editable notes",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await openExtensionsMenu(ctx);
		},
	});

	pi.registerCommand("keys", {
		description: "Manage provider API keys, provider visibility, and custom key notes",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await openKeysMenu(ctx);
		},
	});
}
