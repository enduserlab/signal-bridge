import { App, PluginSettingTab, Setting } from "obsidian";
import type SignalBridgePlugin from "./main";

export class SignalBridgeSettingTab extends PluginSettingTab {
	plugin: SignalBridgePlugin;

	constructor(app: App, plugin: SignalBridgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- signal-cli ---
		new Setting(containerEl).setName("signal-cli").setHeading();

		new Setting(containerEl)
			.setName("Signal account")
			.setDesc("Your phone number in international format (e.g. +1234567890).")
			.addText((text) =>
				text
					.setPlaceholder("+1234567890")
					.setValue(this.plugin.settings.signalAccount)
					.onChange(async (value) => {
						this.plugin.settings.signalAccount = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("signal-cli path")
			.setDesc(
				"Path to the signal-cli binary. Use just \"signal-cli\" if it's on your PATH."
			)
			.addText((text) =>
				text
					.setPlaceholder("signal-cli")
					.setValue(this.plugin.settings.signalCliPath)
					.onChange(async (value) => {
						this.plugin.settings.signalCliPath = value || "signal-cli";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Config directory")
			.setDesc(
				"signal-cli data directory. Leave blank to auto-detect (~/.local/share/signal-cli)."
			)
			.addText((text) =>
				text
					.setPlaceholder("Auto-detect")
					.setValue(this.plugin.settings.signalConfigDir)
					.onChange(async (value) => {
						this.plugin.settings.signalConfigDir = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Inbox ---
		new Setting(containerEl).setName("Inbox").setHeading();

		new Setting(containerEl)
			.setName("Inbox folder")
			.setDesc("Where incoming messages are written. The Signal Inbox plugin watches this folder.")
			.addText((text) =>
				text
					.setPlaceholder("_inbox/signal")
					.setValue(this.plugin.settings.inboxPath)
					.onChange(async (value) => {
						this.plugin.settings.inboxPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attachment folder")
			.setDesc("Where images, voice messages, and other attachments are stored.")
			.addText((text) =>
				text
					.setPlaceholder("_inbox/attachments")
					.setValue(this.plugin.settings.attachmentPath)
					.onChange(async (value) => {
						this.plugin.settings.attachmentPath = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Behavior ---
		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Auto-start")
			.setDesc("Start listening for messages when Obsidian launches.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStart)
					.onChange(async (value) => {
						this.plugin.settings.autoStart = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include group messages")
			.setDesc("Capture messages from Signal groups in addition to direct messages.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeGroupMessages)
					.onChange(async (value) => {
						this.plugin.settings.includeGroupMessages = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Poll interval (seconds)")
			.setDesc("How often to check signal-cli for new messages.")
			.addSlider((slider) =>
				slider
					.setLimits(3, 60, 1)
					.setValue(this.plugin.settings.pollIntervalSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.pollIntervalSeconds = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Commands ---
		new Setting(containerEl).setName("Commands").setHeading();

		new Setting(containerEl)
			.setName("Enable Signal commands")
			.setDesc(
				"Respond to slash commands sent to yourself via Signal (Note to Self). " +
				"Commands: /help, /search, /recent, /status, /note."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableCommands)
					.onChange(async (value) => {
						this.plugin.settings.enableCommands = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Search folders")
			.setDesc(
				"Vault folders to search when using /search. Comma-separated, relative to vault root."
			)
			.addText((text) => {
				text
					.setPlaceholder("_inbox/processed, inbox, wiki")
					.setValue(this.plugin.settings.searchFolders.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.searchFolders = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = "100%";
			});

		// --- Setup guide ---
		new Setting(containerEl).setName("Setup guide").setHeading();

		new Setting(containerEl).setDesc(
			createFragment((el) => {
				el.createEl("strong", { text: "Prerequisites: " });
				el.appendText("Java 21+ and signal-cli 0.13+");
				el.createEl("br");
				el.createEl("br");
				el.createEl("strong", { text: "1. Install signal-cli" });
				el.createEl("br");
				el.createEl("code", { text: "brew install signal-cli" });
				el.appendText(" (macOS) or download from GitHub");
				el.createEl("br");
				el.createEl("br");
				el.createEl("strong", { text: "2. Link as a secondary device" });
				el.createEl("br");
				el.createEl("code", { text: 'signal-cli link -n "Obsidian"' });
				el.createEl("br");
				el.appendText("Scan the QR code: Signal \u2192 Settings \u2192 Linked Devices");
				el.createEl("br");
				el.createEl("br");
				el.createEl("strong", { text: "3. Configure" });
				el.createEl("br");
				el.appendText("Enter your phone number above and start the bridge.");
				el.createEl("br");
				el.createEl("br");
				el.createEl("strong", { text: "4. Install Signal Inbox plugin" });
				el.createEl("br");
				el.appendText("For automatic classification, install the companion Signal Inbox plugin.");
			})
		);
	}
}
