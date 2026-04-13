import { type App, TFile, TFolder, normalizePath } from "obsidian";
import { execFile } from "child_process";
import type { SignalBridgeSettings, SignalMessage } from "./types";

/**
 * Handles slash commands sent to yourself via Signal (Note to Self).
 */
export class CommandHandler {
	private app: App;
	private settings: SignalBridgeSettings;

	constructor(app: App, settings: SignalBridgeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: SignalBridgeSettings): void {
		this.settings = settings;
	}

	/** Check if a message is a command (outgoing + starts with /). */
	isCommand(message: SignalMessage): boolean {
		return (
			this.settings.enableCommands &&
			message.isOutgoing &&
			message.body.trim().startsWith("/")
		);
	}

	/** Handle a command and send the response back via Signal. */
	async handle(message: SignalMessage): Promise<void> {
		const raw = message.body.trim().slice(1).trim();
		const spaceIdx = raw.indexOf(" ");
		const cmd = spaceIdx === -1 ? raw.toLowerCase() : raw.slice(0, spaceIdx).toLowerCase();
		const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();

		let response: string;
		switch (cmd) {
			case "help":
				response = this.helpText();
				break;
			case "search":
			case "find":
				response = await this.search(args);
				break;
			case "recent":
				response = await this.listRecent(parseInt(args) || 5);
				break;
			case "status":
				response = this.getStatus();
				break;
			case "note":
			case "save":
				response = await this.saveNote(args);
				break;
			default:
				response = `Unknown command: /${cmd}\n\nType /help for available commands.`;
		}

		await this.sendSelfResponse(response);
	}

	// --- Commands ---

	private helpText(): string {
		return [
			"Signal Bridge Commands:",
			"",
			"/search <query> - Search your vault",
			"/recent [n] - Show n most recent classified messages (default 5)",
			"/status - Bridge and inbox stats",
			"/note <text> - Save a quick note to the inbox",
			"/help - Show this message",
		].join("\n");
	}

	private async search(query: string): Promise<string> {
		if (!query) return "Usage: /search <query>";

		const results: Array<{ file: string; line: string }> = [];
		const q = query.toLowerCase();

		for (const dir of this.settings.searchFolders) {
			const folder = this.app.vault.getAbstractFileByPath(
				normalizePath(dir)
			);
			if (!(folder instanceof TFolder)) continue;

			await this.searchFolder(folder, q, results);
			if (results.length >= 20) break;
		}

		if (results.length === 0) {
			return `No results for "${query}"`;
		}

		const display = results.slice(0, 8).map(
			(r, i) => `${i + 1}. ${r.file}\n   ${r.line}`
		);

		return [
			`Found ${results.length} match${results.length === 1 ? "" : "es"} for "${query}":`,
			"",
			...display,
			results.length > 8
				? `\n...and ${results.length - 8} more`
				: "",
		].join("\n");
	}

	private async searchFolder(
		folder: TFolder,
		query: string,
		results: Array<{ file: string; line: string }>
	): Promise<void> {
		for (const child of folder.children) {
			if (results.length >= 20) return;

			if (child instanceof TFolder) {
				await this.searchFolder(child, query, results);
			} else if (child instanceof TFile && child.extension === "md") {
				const content = await this.app.vault.read(child);
				if (content.toLowerCase().includes(query)) {
					const matchLine = content
						.split("\n")
						.find((l) => l.toLowerCase().includes(query));
					results.push({
						file: child.basename,
						line: (matchLine ?? "").trim().slice(0, 80),
					});
				}
			}
		}
	}

	private async listRecent(count: number): Promise<string> {
		const processed = this.app.vault.getAbstractFileByPath(
			normalizePath("_inbox/processed")
		);
		if (!(processed instanceof TFolder)) {
			return "No processed messages found yet.";
		}

		const files = processed.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, count);

		if (files.length === 0) {
			return "No processed messages found yet.";
		}

		const lines: string[] = [];
		for (let i = 0; i < files.length; i++) {
			const content = await this.app.vault.read(files[i]);
			const summary =
				this.extractField(content, "signal-inbox-summary") ??
				files[i].basename;
			const category =
				this.extractField(content, "signal-inbox-category") ?? "?";
			lines.push(`${i + 1}. [${category}] ${summary}`);
		}

		return ["Recent messages:", "", ...lines].join("\n");
	}

	private getStatus(): string {
		const inboxFolder = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.inboxPath)
		);
		const processedFolder = this.app.vault.getAbstractFileByPath(
			normalizePath("_inbox/processed")
		);

		const inboxCount =
			inboxFolder instanceof TFolder
				? inboxFolder.children.filter(
						(f) => f instanceof TFile && f.extension === "md"
					).length
				: 0;

		const processedCount =
			processedFolder instanceof TFolder
				? processedFolder.children.filter(
						(f) => f instanceof TFile && f.extension === "md"
					).length
				: 0;

		return [
			"Signal Bridge Status:",
			`  Inbox: ${inboxCount} pending`,
			`  Processed: ${processedCount} classified`,
			`  Account: ${this.settings.signalAccount}`,
			`  Groups: ${this.settings.includeGroupMessages ? "included" : "excluded"}`,
		].join("\n");
	}

	private async saveNote(text: string): Promise<string> {
		if (!text) return "Usage: /note <your note text>";

		await this.ensureFolder(this.settings.inboxPath);

		const now = new Date();
		const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
		const filename = `${ts}_quick-note.md`;
		const filePath = normalizePath(
			`${this.settings.inboxPath}/${filename}`
		);

		const content = [
			"---",
			`sender: "You"`,
			`source: "${this.escapeYaml(this.settings.signalAccount)}"`,
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

		await this.app.vault.create(filePath, content);
		return "Saved note to inbox.";
	}

	// --- Signal response ---

	private async sendSelfResponse(text: string): Promise<void> {
		const args: string[] = [];
		if (this.settings.signalConfigDir) {
			args.push("--config", this.settings.signalConfigDir);
		}
		args.push(
			"-a", this.settings.signalAccount,
			"send",
			"-m", text,
			this.settings.signalAccount
		);

		return new Promise((resolve) => {
			execFile(
				this.settings.signalCliPath,
				args,
				{ timeout: 30_000 },
				(err) => {
					if (err) {
						console.error("Signal Bridge: Failed to send response:", err.message);
					}
					resolve();
				}
			);
		});
	}

	// --- Helpers ---

	private extractField(content: string, field: string): string | null {
		const regex = new RegExp(`^${field}:\\s*"?([^"\\n]*)"?`, "m");
		const match = content.match(regex);
		return match?.[1]?.trim() ?? null;
	}

	private escapeYaml(s: string): string {
		return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	private async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFolder) return;

		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const folder = this.app.vault.getAbstractFileByPath(current);
			if (!folder) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
