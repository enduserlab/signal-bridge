import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { BridgeConfig, SignalEnvelope, SignalMessage } from "./types.js";

/** How often to poll for messages (ms). */
const POLL_INTERVAL_MS = 5000;

/** How long to let signal-cli receive run before timing out (seconds). */
const RECEIVE_TIMEOUT_S = 3;

/**
 * Polls signal-cli receive for incoming messages
 * and emits parsed SignalMessage events.
 */
export class SignalListener extends EventEmitter {
	private config: BridgeConfig;
	private timer: ReturnType<typeof setInterval> | null = null;
	private polling: boolean = false;

	constructor(config: BridgeConfig) {
		super();
		this.config = config;
	}

	/**
	 * Start polling for messages.
	 */
	start(): void {
		this.log("info", "Starting message polling...");

		// Initial receive
		this.receive();

		// Start polling loop
		this.timer = setInterval(() => this.receive(), POLL_INTERVAL_MS);
	}

	/**
	 * Stop polling.
	 */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Run signal-cli receive once, parse output, emit messages.
	 */
	private receive(): void {
		if (this.polling) return;
		this.polling = true;

		const args = [
			"--config", this.config.signalCli.configDir,
			"-a", this.config.signalCli.account,
			"--output=json",
			"receive",
			"--timeout", String(RECEIVE_TIMEOUT_S),
		];

		this.log("debug", "Polling for messages...");

		const proc = spawn(this.config.signalCli.path, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";

		proc.stdout!.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		proc.stderr!.on("data", (chunk: Buffer) => {
			const line = chunk.toString().trim();
			// signal-cli logs INFO lines to stderr — only warn on real errors
			if (line && !line.startsWith("INFO")) {
				this.log("warn", `signal-cli: ${line}`);
			}
		});

		proc.on("error", (err) => {
			this.polling = false;
			this.log("error", `Failed to run signal-cli: ${err.message}`);
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				this.log("error", `signal-cli not found at: ${this.config.signalCli.path}`);
			}
			this.emit("error", err);
		});

		proc.on("close", (code) => {
			this.polling = false;

			if (code !== 0 && code !== null) {
				this.log("warn", `signal-cli receive exited with code ${code}`);
				return;
			}

			const lines = stdout.trim().split("\n").filter(Boolean);
			let count = 0;

			for (const line of lines) {
				try {
					const json = JSON.parse(line);
					const envelope = this.unwrapEnvelope(json);
					if (!envelope) continue;

					const message = this.parseEnvelope(envelope);
					if (message) {
						this.log("debug", `Message from ${message.senderName} (${message.source}): ${message.body.slice(0, 80)}`);
						this.emit("message", message);
						count++;
					}
				} catch {
					this.log("warn", `Failed to parse: ${line.slice(0, 120)}`);
				}
			}

			if (count > 0) {
				this.log("info", `Received ${count} message(s)`);
			}
		});
	}

	/**
	 * Unwrap the envelope from either JSON-RPC format or plain format.
	 */
	private unwrapEnvelope(json: Record<string, unknown>): SignalEnvelope | null {
		// JSON-RPC format
		if (json.jsonrpc && json.method === "receive") {
			const params = json.params as Record<string, unknown> | undefined;
			return (params?.envelope as SignalEnvelope) ?? null;
		}
		// Plain format: {"envelope":{...}}
		if (json.envelope) {
			return json.envelope as SignalEnvelope;
		}
		return null;
	}

	/**
	 * Convert a raw envelope into a SignalMessage, or null if not a message.
	 */
	private parseEnvelope(envelope: SignalEnvelope): SignalMessage | null {
		// Incoming data message
		if (envelope.dataMessage) {
			const dm = envelope.dataMessage;

			if (!dm.message && (!dm.attachments || dm.attachments.length === 0)) {
				return null;
			}

			if (dm.groupInfo && !this.config.includeGroupMessages) {
				return null;
			}

			return {
				source: envelope.sourceNumber ?? envelope.source ?? "unknown",
				senderName: envelope.sourceName ?? envelope.sourceNumber ?? envelope.source ?? "Unknown",
				timestamp: dm.timestamp ?? envelope.timestamp ?? Date.now(),
				body: dm.message ?? "",
				attachments: dm.attachments ?? [],
				groupId: dm.groupInfo?.groupId ?? null,
				groupName: dm.groupInfo?.groupName ?? null,
				isOutgoing: false,
			};
		}

		// Sync message (message you sent from another device)
		if (envelope.syncMessage?.sentMessage) {
			const sm = envelope.syncMessage.sentMessage;

			if (!sm.message && (!sm.attachments || sm.attachments.length === 0)) {
				return null;
			}

			if (sm.groupInfo && !this.config.includeGroupMessages) {
				return null;
			}

			return {
				source: sm.destinationNumber ?? sm.destination ?? "unknown",
				senderName: "You",
				timestamp: sm.timestamp ?? envelope.timestamp ?? Date.now(),
				body: sm.message ?? "",
				attachments: sm.attachments ?? [],
				groupId: sm.groupInfo?.groupId ?? null,
				groupName: sm.groupInfo?.groupName ?? null,
				isOutgoing: true,
			};
		}

		return null;
	}

	private log(level: string, msg: string): void {
		const levels = ["debug", "info", "warn", "error"];
		if (levels.indexOf(level) >= levels.indexOf(this.config.logLevel)) {
			const ts = new Date().toISOString();
			console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
		}
	}
}
