import { Notice, Plugin } from "obsidian";
import type { SignalBridgeSettings, SignalMessage } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SignalListener } from "./listener";
import { MessageWriter } from "./writer";
import { CommandHandler } from "./commands";
import { SignalBridgeSettingTab } from "./settings";

export default class SignalBridgePlugin extends Plugin {
	settings: SignalBridgeSettings = DEFAULT_SETTINGS;
	private listener: SignalListener | null = null;
	private writer: MessageWriter | null = null;
	private commands: CommandHandler | null = null;
	private statusBarEl: HTMLElement | null = null;
	private listening = false;
	private messageCount = 0;
	private errorNoticeShown = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Status bar
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatus("Idle");

		// Initialize components
		this.writer = new MessageWriter(this.app, this.settings);
		this.commands = new CommandHandler(this.app, this.settings);

		// Auto-start once the vault layout is ready
		if (this.settings.autoStart && this.settings.signalAccount) {
			this.app.workspace.onLayoutReady(() => this.startListening());
		} else if (!this.settings.signalAccount) {
			this.updateStatus("Not configured");
		}

		// Ribbon icon
		this.addRibbonIcon(
			"radio",
			"Signal Bridge: Toggle listening",
			async () => {
				if (this.listening) {
					this.stopListening();
					new Notice("Signal Bridge: Stopped");
				} else {
					if (!this.settings.signalAccount) {
						new Notice(
							"Signal Bridge: Set your Signal account in settings first."
						);
						return;
					}
					this.startListening();
					new Notice("Signal Bridge: Listening for messages...");
				}
			}
		);

		// --- Commands ---

		this.addCommand({
			id: "start-bridge",
			name: "Start listening",
			callback: () => {
				if (this.listening) {
					new Notice("Signal Bridge: Already listening.");
					return;
				}
				if (!this.settings.signalAccount) {
					new Notice(
						"Signal Bridge: Set your Signal account in settings first."
					);
					return;
				}
				this.startListening();
				new Notice("Signal Bridge: Listening for messages...");
			},
		});

		this.addCommand({
			id: "stop-bridge",
			name: "Stop listening",
			callback: () => {
				if (!this.listening) {
					new Notice("Signal Bridge: Not currently listening.");
					return;
				}
				this.stopListening();
				new Notice("Signal Bridge: Stopped.");
			},
		});

		this.addCommand({
			id: "bridge-status",
			name: "Show status",
			callback: () => {
				const status = this.listening ? "listening" : "stopped";
				new Notice(
					`Signal Bridge: ${status}, ${this.messageCount} message(s) this session`
				);
			},
		});

		// Settings tab
		this.addSettingTab(new SignalBridgeSettingTab(this.app, this));

		// Cleanup on unload
		this.register(() => this.stopListening());
	}

	onunload(): void {
		// Cleanup handled by this.register() callbacks
	}

	// --- Lifecycle ---

	startListening(): void {
		if (this.listening) return;

		if (!this.settings.signalAccount) {
			this.updateStatus("Not configured");
			return;
		}

		this.errorNoticeShown = false;

		this.listener = new SignalListener(
			this.settings,
			(message) => this.onMessage(message),
			(error) => this.onError(error)
		);

		this.listener.start();
		this.listening = true;
		this.updateStatus(`Listening (${this.messageCount})`);
	}

	stopListening(): void {
		if (this.listener) {
			this.listener.stop();
			this.listener = null;
		}
		this.listening = false;
		this.updateStatus("Stopped");
	}

	// --- Message handling ---

	private async onMessage(message: SignalMessage): Promise<void> {
		try {
			// Check for commands first
			if (this.commands?.isCommand(message)) {
				await this.commands.handle(message);
				return;
			}

			// Write message to inbox
			const path = await this.writer?.write(message);
			if (path) {
				this.messageCount++;
				this.updateStatus(`Listening (${this.messageCount})`);

				const sender = message.groupName
					? `${message.groupName} (${message.senderName})`
					: message.senderName;

				new Notice(`Signal Bridge: New message from ${sender}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Signal Bridge: Failed to process message:", msg);
		}
	}

	private onError(error: string): void {
		// Only show the first error notice to avoid spam
		if (!this.errorNoticeShown) {
			new Notice(`Signal Bridge: ${error}`);
			this.errorNoticeShown = true;
		}
		this.updateStatus("Error");
	}

	// --- Status ---

	private updateStatus(status: string): void {
		this.statusBarEl?.setText(`Signal: ${status}`);
	}

	// --- Settings ---

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Propagate settings to active components
		this.listener?.updateSettings(this.settings);
		this.writer?.updateSettings(this.settings);
		this.commands?.updateSettings(this.settings);
	}
}
