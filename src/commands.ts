import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BridgeConfig, SignalMessage } from "./types.js";

const execFileAsync = promisify(execFile);

/** Command prefix — messages starting with this are treated as commands. */
const CMD_PREFIX = "/";

/**
 * Check if a message is a command (outgoing message starting with /).
 */
export function isCommand(message: SignalMessage): boolean {
	return message.isOutgoing && message.body.trim().startsWith(CMD_PREFIX);
}

/**
 * Handle a command message. Returns the response text to send back.
 */
export async function handleCommand(
	message: SignalMessage,
	config: BridgeConfig
): Promise<string> {
	const raw = message.body.trim().slice(CMD_PREFIX.length).trim();
	const spaceIndex = raw.indexOf(" ");
	const cmd = spaceIndex === -1 ? raw.toLowerCase() : raw.slice(0, spaceIndex).toLowerCase();
	const args = spaceIndex === -1 ? "" : raw.slice(spaceIndex + 1).trim();

	switch (cmd) {
		case "help":
			return formatHelp();
		case "search":
		case "find":
			return searchVault(args, config);
		case "recent":
			return listRecent(config, parseInt(args) || 5);
		case "status":
			return getStatus(config);
		case "note":
		case "save":
			return saveNote(args, config);
		default:
			return `Unknown command: /${cmd}\n\nType /help for available commands.`;
	}
}

/**
 * Send a response back via signal-cli.
 */
export async function sendResponse(
	text: string,
	recipientNumber: string,
	config: BridgeConfig
): Promise<void> {
	try {
		await execFileAsync(config.signalCli.path, [
			"--config", config.signalCli.configDir,
			"-a", config.signalCli.account,
			"send",
			"-m", text,
			recipientNumber,
		], { timeout: 30_000 });
	} catch (err) {
		console.error(`[ERROR] Failed to send response: ${err}`);
	}
}

/**
 * Send a response to yourself (Note to Self).
 */
export async function sendSelfResponse(
	text: string,
	config: BridgeConfig
): Promise<void> {
	await sendResponse(text, config.signalCli.account, config);
}

// --- Command implementations ---

function formatHelp(): string {
	return [
		"Signal Inbox Commands:",
		"",
		"/search <query> — Search your vault for matching messages",
		"/recent [n] — Show the n most recent classified messages (default 5)",
		"/status — Show bridge and inbox stats",
		"/note <text> — Save a quick note to the inbox",
		"/help — Show this message",
	].join("\n");
}

function searchVault(query: string, config: BridgeConfig): string {
	if (!query) return "Usage: /search <query>";

	const results: Array<{ file: string; line: string }> = [];
	const vaultRoot = config.vault.inboxPath.replace(/_inbox\/signal\/?$/, "");

	// Search across common vault folders
	const searchDirs = [
		"_inbox/processed",
		"inbox",
		"wiki",
	];

	for (const dir of searchDirs) {
		const fullDir = join(vaultRoot, dir);
		try {
			searchDir(fullDir, query.toLowerCase(), results);
		} catch {
			// Directory may not exist
		}
	}

	if (results.length === 0) {
		return `No results for "${query}"`;
	}

	const display = results.slice(0, 8).map((r, i) =>
		`${i + 1}. ${r.file}\n   ${r.line}`
	);

	return [
		`Found ${results.length} match${results.length === 1 ? "" : "es"} for "${query}":`,
		"",
		...display,
		results.length > 8 ? `\n...and ${results.length - 8} more` : "",
	].join("\n");
}

function searchDir(
	dir: string,
	query: string,
	results: Array<{ file: string; line: string }>
): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			searchDir(fullPath, query, results);
		} else if (entry.name.endsWith(".md")) {
			try {
				const content = readFileSync(fullPath, "utf-8");
				if (content.toLowerCase().includes(query)) {
					// Find the matching line for context
					const lines = content.split("\n");
					const matchLine = lines.find((l) =>
						l.toLowerCase().includes(query)
					);
					results.push({
						file: entry.name.replace(/\.md$/, ""),
						line: (matchLine ?? "").trim().slice(0, 80),
					});
				}
			} catch {
				// Skip unreadable files
			}
		}
	}
}

function listRecent(config: BridgeConfig, count: number): string {
	const vaultRoot = config.vault.inboxPath.replace(/_inbox\/signal\/?$/, "");
	const processedDir = join(vaultRoot, "_inbox/processed");

	let files: Array<{ name: string; mtime: number }> = [];
	try {
		const entries = readdirSync(processedDir, { withFileTypes: true });
		files = entries
			.filter((e) => e.isFile() && e.name.endsWith(".md"))
			.map((e) => {
				const stat = require("node:fs").statSync(join(processedDir, e.name));
				return { name: e.name, mtime: stat.mtimeMs };
			})
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, count);
	} catch {
		return "No processed messages found yet.";
	}

	if (files.length === 0) {
		return "No processed messages found yet.";
	}

	const lines = files.map((f, i) => {
		const content = readFileSync(join(processedDir, f.name), "utf-8");
		const summary = extractFrontmatterField(content, "signal-inbox-summary") ?? f.name;
		const category = extractFrontmatterField(content, "signal-inbox-category") ?? "?";
		return `${i + 1}. [${category}] ${summary}`;
	});

	return [`Recent messages:`, "", ...lines].join("\n");
}

function getStatus(config: BridgeConfig): string {
	let inboxCount = 0;
	let processedCount = 0;
	const vaultRoot = config.vault.inboxPath.replace(/_inbox\/signal\/?$/, "");

	try {
		inboxCount = readdirSync(config.vault.inboxPath)
			.filter((f) => f.endsWith(".md")).length;
	} catch { /* empty */ }

	try {
		processedCount = readdirSync(join(vaultRoot, "_inbox/processed"))
			.filter((f) => f.endsWith(".md")).length;
	} catch { /* empty */ }

	return [
		"Signal Inbox Status:",
		`  Inbox: ${inboxCount} pending`,
		`  Processed: ${processedCount} classified`,
		`  Account: ${config.signalCli.account}`,
		`  Groups: ${config.includeGroupMessages ? "included" : "excluded"}`,
	].join("\n");
}

function saveNote(text: string, config: BridgeConfig): string {
	if (!text) return "Usage: /note <your note text>";

	const { writeFileSync } = require("node:fs");
	const now = new Date();
	const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
	const filename = `${ts}_quick-note.md`;
	const filepath = join(config.vault.inboxPath, filename);

	const content = [
		"---",
		`sender: "You"`,
		`source: "${config.signalCli.account}"`,
		`timestamp: ${now.getTime()}`,
		`date: "${now.toISOString()}"`,
		`type: "signal-command"`,
		"---",
		"",
		"# Quick Note",
		"",
		text,
		"",
	].join("\n");

	writeFileSync(filepath, content, "utf-8");
	return `Saved note to inbox.`;
}

function extractFrontmatterField(content: string, field: string): string | null {
	const regex = new RegExp(`^${field}:\\s*"?([^"\\n]*)"?`, "m");
	const match = content.match(regex);
	return match?.[1]?.trim() ?? null;
}
