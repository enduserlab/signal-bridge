import { type App, TFolder, normalizePath } from "obsidian";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import type { SignalBridgeSettings, SignalMessage, SignalAttachment } from "./types";

/**
 * Writes Signal messages as markdown files into the vault.
 * Uses Obsidian's vault API for all in-vault operations
 * and Node fs for reading from signal-cli's external storage.
 */
export class MessageWriter {
	private app: App;
	private settings: SignalBridgeSettings;

	constructor(app: App, settings: SignalBridgeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: SignalBridgeSettings): void {
		this.settings = settings;
	}

	/**
	 * Write a Signal message as a markdown file in the vault inbox.
	 * Returns the vault path of the created file.
	 */
	async write(message: SignalMessage): Promise<string> {
		await this.ensureFolder(this.settings.inboxPath);

		const filename = this.buildFilename(message);
		const attachmentEmbeds = await this.copyAttachments(message);
		const markdown = this.buildMarkdown(message, attachmentEmbeds);

		const filePath = this.deduplicatePath(this.settings.inboxPath, filename);
		await this.app.vault.create(filePath, markdown);

		return filePath;
	}

	// --- Filename ---

	private buildFilename(message: SignalMessage): string {
		const date = new Date(message.timestamp);
		const dateStr = date.toISOString().slice(0, 10);
		const timeStr = date.toISOString().slice(11, 19).replace(/:/g, "");

		const sender = this.cleanName(message.senderName);
		const group = message.groupName
			? `${this.cleanName(message.groupName)} - `
			: "";

		return `${sender} - ${dateStr} - ${group}${timeStr}.md`;
	}

	private cleanName(name: string): string {
		return name
			.replace(/[^a-zA-Z0-9 _-]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 30);
	}

	// --- Attachments ---

	private async copyAttachments(message: SignalMessage): Promise<string[]> {
		if (message.attachments.length === 0) return [];

		await this.ensureFolder(this.settings.attachmentPath);
		const embeds: string[] = [];

		for (const att of message.attachments) {
			const sourcePath = this.findAttachmentFile(att);
			if (!sourcePath) {
				embeds.push(`> [Attachment not found: ${att.id}]`);
				continue;
			}

			try {
				const ext = this.getExtension(att);
				const destName = `${att.id}${ext}`;
				const destPath = normalizePath(
					`${this.settings.attachmentPath}/${destName}`
				);

				// Read from signal-cli storage (outside vault) via Node fs,
				// write into vault via Obsidian adapter
				const data = readFileSync(sourcePath);
				await this.app.vault.adapter.writeBinary(
					destPath,
					data.buffer.slice(
						data.byteOffset,
						data.byteOffset + data.byteLength
					)
				);

				// Build Obsidian-style embed
				if (att.contentType.startsWith("image/")) {
					embeds.push(`![[${destPath}]]`);
				} else if (att.contentType.startsWith("audio/")) {
					embeds.push(`![[${destPath}]] *(voice message)*`);
				} else if (att.contentType.startsWith("video/")) {
					embeds.push(`![[${destPath}]] *(video)*`);
				} else {
					embeds.push(
						`[[${destPath}|${att.filename ?? destName}]]`
					);
				}
			} catch {
				embeds.push(`> [Failed to copy attachment: ${att.id}]`);
			}
		}

		return embeds;
	}

	private findAttachmentFile(att: SignalAttachment): string | null {
		const configDir = this.resolveSignalConfigDir();
		const attachDir = join(configDir, "attachments");
		const candidate = join(attachDir, att.id);
		if (existsSync(candidate)) return candidate;
		if (att.filename) {
			const withName = join(attachDir, att.filename);
			if (existsSync(withName)) return withName;
		}
		return null;
	}

	private resolveSignalConfigDir(): string {
		if (this.settings.signalConfigDir) {
			return this.settings.signalConfigDir.replace(/^~/, homedir());
		}
		return join(homedir(), ".local", "share", "signal-cli");
	}

	private getExtension(att: SignalAttachment): string {
		if (att.filename) {
			const ext = extname(att.filename);
			if (ext) return ext;
		}
		const map: Record<string, string> = {
			"image/jpeg": ".jpg",
			"image/png": ".png",
			"image/gif": ".gif",
			"image/webp": ".webp",
			"audio/aac": ".aac",
			"audio/mpeg": ".mp3",
			"audio/ogg": ".ogg",
			"video/mp4": ".mp4",
			"application/pdf": ".pdf",
		};
		return map[att.contentType] ?? "";
	}

	// --- Markdown ---

	private buildMarkdown(
		message: SignalMessage,
		attachmentEmbeds: string[]
	): string {
		const date = new Date(message.timestamp);

		const fm: Record<string, string | number | boolean | string[]> = {
			sender: message.senderName,
			source: message.source,
			timestamp: message.timestamp,
			date: date.toISOString(),
			type: "signal-message",
		};

		if (message.isOutgoing) {
			fm["direction"] = "outgoing";
		}
		if (message.groupId) {
			fm["group-id"] = message.groupId;
		}
		if (message.groupName) {
			fm["group-name"] = message.groupName;
		}
		if (message.attachments.length > 0) {
			fm["has-attachments"] = true;
			fm["attachment-types"] = [
				...new Set(message.attachments.map((a) => a.contentType)),
			];
		}

		const urls = this.extractUrls(message.body);
		if (urls.length > 0) {
			fm["urls"] = urls;
		}

		const yamlLines = Object.entries(fm).map(([key, value]) => {
			if (Array.isArray(value)) {
				if (value.length === 0) return `${key}: []`;
				return `${key}:\n${value.map((v) => `  - "${this.escapeYaml(String(v))}"`).join("\n")}`;
			}
			if (typeof value === "string")
				return `${key}: "${this.escapeYaml(value)}"`;
			return `${key}: ${value}`;
		});

		const direction = message.isOutgoing ? "to" : "from";
		const target = message.groupName
			? `${message.groupName} (${direction} ${message.senderName})`
			: message.senderName;
		const heading = `# Message ${direction} ${target}`;

		const sections: string[] = [heading, ""];
		if (message.body) {
			sections.push(message.body);
		}
		if (attachmentEmbeds.length > 0) {
			if (message.body) sections.push("");
			sections.push("## Attachments", "");
			sections.push(...attachmentEmbeds);
		}

		return `---\n${yamlLines.join("\n")}\n---\n\n${sections.join("\n")}\n`;
	}

	private extractUrls(text: string): string[] {
		const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
		return [...(text.match(urlRegex) ?? [])];
	}

	private escapeYaml(s: string): string {
		return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	// --- Helpers ---

	private deduplicatePath(folder: string, filename: string): string {
		const base = filename.replace(/\.md$/, "");
		let candidate = normalizePath(`${folder}/${filename}`);
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = normalizePath(`${folder}/${base} ${i}.md`);
			i++;
		}
		return candidate;
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
