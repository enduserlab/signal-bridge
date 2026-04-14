import { spawn, type ChildProcess } from "child_process";
import type {
	SignalBridgeSettings,
	SignalMessage,
	SignalEnvelope,
} from "./types";

/** How long to let signal-cli receive run before timing out (seconds). */
const RECEIVE_TIMEOUT_S = 3;

export type MessageCallback = (message: SignalMessage) => Promise<void> | void;
export type ErrorCallback = (error: string) => void;

/**
 * Polls signal-cli receive for incoming messages
 * and fires callbacks with parsed SignalMessage objects.
 */
export class SignalListener {
	private settings: SignalBridgeSettings;
	private pollTimer: number | null = null;
	private polling = false;
	private currentProc: ChildProcess | null = null;
	private onMessage: MessageCallback;
	private onError: ErrorCallback;

	constructor(
		settings: SignalBridgeSettings,
		onMessage: MessageCallback,
		onError: ErrorCallback
	) {
		this.settings = settings;
		this.onMessage = onMessage;
		this.onError = onError;
	}

	updateSettings(settings: SignalBridgeSettings): void {
		const oldInterval = this.settings.pollIntervalSeconds;
		this.settings = settings;

		// Re-create the poll timer if the interval changed
		if (oldInterval !== settings.pollIntervalSeconds && this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = window.setInterval(
				() => this.receive(),
				settings.pollIntervalSeconds * 1000
			);
		}
	}

	start(): void {
		this.receive();
		this.pollTimer = window.setInterval(
			() => this.receive(),
			this.settings.pollIntervalSeconds * 1000
		);
	}

	stop(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.currentProc) {
			this.currentProc.kill();
			this.currentProc = null;
		}
		this.polling = false;
	}

	/**
	 * Run signal-cli receive once, parse output, fire callbacks.
	 */
	private receive(): void {
		if (this.polling) return;
		this.polling = true;

		const args: string[] = [];
		if (this.settings.signalConfigDir) {
			args.push("--config", this.settings.signalConfigDir);
		}
		args.push(
			"-a", this.settings.signalAccount,
			"--output=json",
			"receive",
			"--timeout", String(RECEIVE_TIMEOUT_S)
		);

		const proc = spawn(this.settings.signalCliPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.currentProc = proc;

		let stdout = "";

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		proc.stderr?.on("data", (_chunk: Buffer) => {
			// signal-cli logs INFO lines to stderr — ignore them
		});

		proc.on("error", (err) => {
			this.polling = false;
			this.currentProc = null;
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				this.onError(`signal-cli not found at "${this.settings.signalCliPath}". Check the path in settings.`);
			} else {
				this.onError(`signal-cli error: ${err.message}`);
			}
		});

		proc.on("close", (code) => {
			this.polling = false;
			this.currentProc = null;

			if (code !== 0 && code !== null) return;

			const messages: SignalMessage[] = [];
			const lines = stdout.trim().split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const json = JSON.parse(line);
					const envelope = this.unwrapEnvelope(json);
					if (!envelope) continue;

					const message = this.parseEnvelope(envelope);
					if (message) {
						messages.push(message);
					}
				} catch {
					// Skip unparseable lines (signal-cli info output, etc.)
				}
			}

			if (messages.length > 0) {
				void this.processSequentially(messages);
			}
		});
	}

	/**
	 * Process messages one at a time to avoid race conditions
	 * in folder creation and file deduplication.
	 */
	private async processSequentially(messages: SignalMessage[]): Promise<void> {
		for (const msg of messages) {
			try {
				await this.onMessage(msg);
			} catch {
				// Errors handled by the callback
			}
		}
	}

	private unwrapEnvelope(json: Record<string, unknown>): SignalEnvelope | null {
		if (json.jsonrpc && json.method === "receive") {
			const params = json.params as Record<string, unknown> | undefined;
			return (params?.envelope as SignalEnvelope) ?? null;
		}
		if (json.envelope) {
			return json.envelope as SignalEnvelope;
		}
		return null;
	}

	private parseEnvelope(envelope: SignalEnvelope): SignalMessage | null {
		// Incoming data message
		if (envelope.dataMessage) {
			const dm = envelope.dataMessage;
			if (!dm.message && (!dm.attachments || dm.attachments.length === 0)) {
				return null;
			}
			if (dm.groupInfo && !this.settings.includeGroupMessages) {
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

		// Sync message (sent from another device)
		if (envelope.syncMessage?.sentMessage) {
			const sm = envelope.syncMessage.sentMessage;
			if (!sm.message && (!sm.attachments || sm.attachments.length === 0)) {
				return null;
			}
			if (sm.groupInfo && !this.settings.includeGroupMessages) {
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
}
