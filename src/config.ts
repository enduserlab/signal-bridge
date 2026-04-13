import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BridgeConfig } from "./types.js";

const DEFAULTS: BridgeConfig = {
	signalCli: {
		path: "signal-cli",
		account: "",
		configDir: "~/.local/share/signal-cli",
	},
	vault: {
		inboxPath: "",
		attachmentPath: "",
	},
	includeGroupMessages: true,
	logLevel: "info",
};

/**
 * Load config from a JSON file, merging with defaults.
 * Accepts an optional path argument; falls back to ./config.json.
 */
export function loadConfig(configPath?: string): BridgeConfig {
	const file = resolve(configPath ?? "config.json");

	if (!existsSync(file)) {
		console.error(`Config file not found: ${file}`);
		console.error("Copy config.example.json to config.json and fill it in.");
		process.exit(1);
	}

	const raw = JSON.parse(readFileSync(file, "utf-8"));

	const config: BridgeConfig = {
		signalCli: { ...DEFAULTS.signalCli, ...raw.signalCli },
		vault: { ...DEFAULTS.vault, ...raw.vault },
		includeGroupMessages: raw.includeGroupMessages ?? DEFAULTS.includeGroupMessages,
		logLevel: raw.logLevel ?? DEFAULTS.logLevel,
	};

	// Expand ~ in paths
	config.signalCli.configDir = expandHome(config.signalCli.configDir);
	config.vault.inboxPath = expandHome(config.vault.inboxPath);
	config.vault.attachmentPath = expandHome(
		config.vault.attachmentPath || `${config.vault.inboxPath}/../attachments`
	);

	// Validate required fields
	if (!config.signalCli.account) {
		console.error("Config error: signalCli.account is required (your phone number, e.g. +1234567890)");
		process.exit(1);
	}
	if (!config.vault.inboxPath) {
		console.error("Config error: vault.inboxPath is required (absolute path to your vault's inbox folder)");
		process.exit(1);
	}

	return config;
}

function expandHome(p: string): string {
	if (p.startsWith("~/")) {
		return p.replace("~", process.env.HOME ?? "~");
	}
	return p;
}
