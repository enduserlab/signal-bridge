import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { BridgeConfig, SignalMessage, SignalAttachment } from "./types.js";

/**
 * Writes Signal messages as markdown files into the Obsidian vault inbox.
 * Handles attachments by copying them from signal-cli's store.
 */
export class MessageWriter {
	private config: BridgeConfig;

	constructor(config: BridgeConfig) {
		this.config = config;
		mkdirSync(config.vault.inboxPath, { recursive: true });
		mkdirSync(config.vault.attachmentPath, { recursive: true });
	}

	/**
	 * Write a Signal message as a markdown file in the vault inbox.
	 * Returns the path of the created file.
	 */
	write(message: SignalMessage): string {
		const filename = this.buildFilename(message);
		const attachmentLinks = this.copyAttachments(message);
		const markdown = this.buildMarkdown(message, attachmentLinks);

		const filepath = this.deduplicatePath(this.config.vault.inboxPath, filename);
		writeFileSync(filepath, markdown, "utf-8");

		this.log("info", `Wrote: ${basename(filepath)}`);
		return filepath;
	}

	/**
	 * Build a filename from the message sender and timestamp.
	 * Format: "Sender - 2026-04-12 - pending.md"
	 * The signal-inbox plugin renames with the topic after classification.
	 */
	private buildFilename(message: SignalMessage): string {
		const date = new Date(message.timestamp);
		const dateStr = date.toISOString().slice(0, 10);
		const timeStr = date.toISOString().slice(11, 19).replace(/:/g, "");

		const sender = this.cleanName(message.senderName);
		const group = message.groupName ? `${this.cleanName(message.groupName)} - ` : "";

		// Include time suffix for uniqueness within the same sender+day
		return `${sender} - ${dateStr} - ${group}${timeStr}.md`;
	}

	/**
	 * Copy attachments from signal-cli's storage into the vault.
	 * Returns markdown-formatted links/embeds for each attachment.
	 */
	private copyAttachments(message: SignalMessage): string[] {
		const links: string[] = [];

		for (const att of message.attachments) {
			const sourcePath = this.findAttachmentFile(att);
			if (!sourcePath) {
				this.log("warn", `Attachment not found: ${att.id}`);
				links.push(`> [Attachment not found: ${att.id}]`);
				continue;
			}

			const ext = this.getExtension(att);
			const destName = `${att.id}${ext}`;
			const destPath = join(this.config.vault.attachmentPath, destName);

			try {
				copyFileSync(sourcePath, destPath);
			} catch (err) {
				this.log("warn", `Failed to copy attachment ${att.id}: ${err}`);
				links.push(`> [Failed to copy attachment: ${att.id}]`);
				continue;
			}

			// Build Obsidian-style embed or link
			const relPath = `${basename(this.config.vault.attachmentPath)}/${destName}`;
			if (att.contentType.startsWith("image/")) {
				links.push(`![[${relPath}]]`);
			} else if (att.contentType.startsWith("audio/")) {
				links.push(`![[${relPath}]] *(voice message)*`);
			} else if (att.contentType.startsWith("video/")) {
				links.push(`![[${relPath}]] *(video)*`);
			} else {
				links.push(`[[${relPath}|${att.filename ?? destName}]]`);
			}
		}

		return links;
	}

	/**
	 * Look for the attachment file in signal-cli's storage.
	 */
	private findAttachmentFile(att: SignalAttachment): string | null {
		const attachDir = join(this.config.signalCli.configDir, "attachments");
		// signal-cli stores attachments with their ID as filename
		const candidate = join(attachDir, att.id);
		if (existsSync(candidate)) return candidate;
		// Sometimes includes the original extension
		if (att.filename) {
			const withName = join(attachDir, att.filename);
			if (existsSync(withName)) return withName;
		}
		return null;
	}

	/**
	 * Build the full markdown content for a message.
	 */
	private buildMarkdown(message: SignalMessage, attachmentLinks: string[]): string {
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
			fm["attachment-types"] = [...new Set(message.attachments.map(a => a.contentType))];
		}

		// Extract URLs from body for the plugin to analyze
		const urls = this.extractUrls(message.body);
		if (urls.length > 0) {
			fm["urls"] = urls;
		}

		const yamlLines = Object.entries(fm).map(([key, value]) => {
			if (Array.isArray(value)) {
				if (value.length === 0) return `${key}: []`;
				return `${key}:\n${value.map(v => `  - "${v}"`).join("\n")}`;
			}
			if (typeof value === "string") return `${key}: "${this.escapeYaml(value)}"`;
			return `${key}: ${value}`;
		});

		// Build heading
		const direction = message.isOutgoing ? "to" : "from";
		const target = message.groupName
			? `${message.groupName} (${direction} ${message.senderName})`
			: message.senderName;
		const heading = `# Message ${direction} ${target}`;

		// Build body sections
		const sections: string[] = [heading, ""];

		if (message.body) {
			sections.push(message.body);
		}

		if (attachmentLinks.length > 0) {
			if (message.body) sections.push("");
			sections.push("## Attachments", "");
			sections.push(...attachmentLinks);
		}

		return `---\n${yamlLines.join("\n")}\n---\n\n${sections.join("\n")}\n`;
	}

	/**
	 * Extract URLs from message text.
	 */
	private extractUrls(text: string): string[] {
		const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
		return [...(text.match(urlRegex) ?? [])];
	}

	/**
	 * Escape special characters for YAML string values.
	 */
	private escapeYaml(s: string): string {
		return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	/**
	 * Get a file extension from an attachment's content type or filename.
	 */
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

	/**
	 * Clean a string for use in filenames.
	 */
	private cleanName(name: string): string {
		return name
			.replace(/[^a-zA-Z0-9_-]/g, "_")
			.replace(/_+/g, "_")
			.slice(0, 30);
	}

	/**
	 * Generate a unique file path, adding a numeric suffix if needed.
	 */
	private deduplicatePath(dir: string, filename: string): string {
		const base = filename.replace(/\.md$/, "");
		let candidate = join(dir, filename);
		let i = 1;
		while (existsSync(candidate)) {
			candidate = join(dir, `${base}_${i}.md`);
			i++;
		}
		return candidate;
	}

	private log(level: string, msg: string): void {
		const levels = ["debug", "info", "warn", "error"];
		if (levels.indexOf(level) >= levels.indexOf(this.config.logLevel)) {
			const ts = new Date().toISOString();
			console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
		}
	}
}
