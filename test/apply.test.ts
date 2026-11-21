import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { ProfileDefinition, StudioConfig } from "../extensions/profile-studio.ts";

// The extension reads the agent directory at call time; point it at an empty one with two local extensions.
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-studio-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
fs.mkdirSync(path.join(agentDir, "extensions"));
for (const name of ["keep.ts", "off.ts"]) {
	fs.writeFileSync(path.join(agentDir, "extensions", name), "");
}

const { applyProfileToSettings } = await import("../extensions/profile-studio.ts");

function makeSettings() {
	return {
		packages: [
			{ source: "npm:pi-lens", autoload: false, extensions: ["lens.ts"], skills: ["s"], prompts: [], themes: [] },
			{ source: "npm:off", extensions: ["off.ts"], skills: [], prompts: [], themes: [] },
		],
		extensions: ["!builtin:web", "+builtin:todo", "-extensions/foreign.ts", "-extensions/keep.ts"],
		enabledModels: ["anthropic/claude-sonnet"],
		defaultProvider: "old",
		defaultModel: "old",
		defaultThinkingLevel: "low",
		theme: "dark",
	};
}

function makeProfile(over: Partial<ProfileDefinition> = {}): ProfileDefinition {
	return { name: "test", note: "", allowedModels: ["*"], activeExtensions: [], activeTools: [], ...over };
}

function makeConfig(): StudioConfig {
	return { version: 2, activeProfile: "test", extensionNotes: {}, savedPackageEntries: {}, profiles: {} };
}

test("apply keeps enabled package filters, unrelated rules and enabledModels", () => {
	const settings = makeSettings();
	const cfg = makeConfig();
	const lensEntry = structuredClone(settings.packages[0]);
	const offEntry = structuredClone(settings.packages[1]);

	applyProfileToSettings(
		settings,
		cfg,
		makeProfile({
			activeExtensions: ["pkg:npm:pi-lens"],
			defaultProvider: "openrouter",
			defaultModel: "deepseek",
			thinkingLevel: "high",
		}),
	);

	assert.deepEqual(settings.packages[0], lensEntry, "an enabled package keeps its entry as written");
	assert.deepEqual(
		settings.packages[1],
		{ source: "npm:off", extensions: [], skills: [], prompts: [], themes: [] },
		"a package the profile turns off is emptied",
	);
	assert.deepEqual(cfg.savedPackageEntries["npm:off"], offEntry, "its original entry is saved for restore");
	assert.equal(settings.packages.length, 2, "no package is added");

	assert.deepEqual(
		[...settings.extensions].sort(),
		["!builtin:web", "+builtin:todo", "-extensions/foreign.ts", "-extensions/keep.ts", "-extensions/off.ts"].sort(),
		"unrelated rules survive and the tool's own rule is written once",
	);
	assert.deepEqual(settings.enabledModels, ["anthropic/claude-sonnet"], "a [\"*\"] profile leaves enabledModels alone");
	assert.equal(settings.theme, "dark", "unrelated settings are untouched");
	assert.equal(settings.defaultProvider, "openrouter");
	assert.equal(settings.defaultModel, "deepseek");
	assert.equal(settings.defaultThinkingLevel, "high");
	assert.equal(settings.defaultTools, undefined, "an empty tool list does not clear defaultTools");
});

test("restore puts the original package entry back and never adds an uninstalled package", () => {
	const settings = makeSettings();
	const cfg = makeConfig();
	const offEntry = structuredClone(settings.packages[1]);

	applyProfileToSettings(settings, cfg, makeProfile({ activeExtensions: ["pkg:npm:pi-lens"] }));
	applyProfileToSettings(
		settings,
		cfg,
		makeProfile({ activeExtensions: ["pkg:npm:pi-lens", "pkg:npm:off", "pkg:npm:not-installed"] }),
	);

	assert.deepEqual(settings.packages[1], offEntry, "re-enabling restores filters and autoload exactly");
	assert.equal(cfg.savedPackageEntries["npm:off"], undefined, "the saved entry is consumed");
	assert.equal(settings.packages.length, 2, "a source absent from settings is not added");
});

test("enabledModels changes only for a concrete model list", () => {
	const settings = makeSettings();
	const cfg = makeConfig();

	applyProfileToSettings(settings, cfg, makeProfile({ allowedModels: [] }));
	assert.deepEqual(settings.enabledModels, ["anthropic/claude-sonnet"]);

	applyProfileToSettings(settings, cfg, makeProfile({ allowedModels: ["openrouter/deepseek"] }));
	assert.deepEqual(settings.enabledModels, ["openrouter/deepseek"]);
});

test("an active local extension loses only this tool's disable rule", () => {
	const settings = makeSettings();

	applyProfileToSettings(settings, makeConfig(), makeProfile({ activeExtensions: ["local:keep.ts", "local:off.ts"] }));

	assert.deepEqual([...settings.extensions].sort(), ["!builtin:web", "+builtin:todo", "-extensions/foreign.ts"]);
});
