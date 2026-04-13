// --- Plugin settings ---

export interface SignalBridgeSettings {
	/** Path to signal-cli binary. */
	signalCliPath: string;
	/** Your Signal account phone number (e.g. "+1234567890"). */
	signalAccount: string;
	/** signal-cli data directory. Leave blank for auto-detect. */
	signalConfigDir: string;
	/** Vault-relative path to the inbox folder. */
	inboxPath: string;
	/** Vault-relative path for storing attachments. */
	attachmentPath: string;
	/** Whether to capture group messages. */
	includeGroupMessages: boolean;
	/** How often to poll for new messages (seconds). */
	pollIntervalSeconds: number;
	/** Start listening when the plugin loads. */
	autoStart: boolean;
	/** Whether to handle /commands sent to yourself. */
	enableCommands: boolean;
	/** Folders to search when running /search command. */
	searchFolders: string[];
}

export const DEFAULT_SETTINGS: SignalBridgeSettings = {
	signalCliPath: "signal-cli",
	signalAccount: "",
	signalConfigDir: "",
	inboxPath: "_inbox/signal",
	attachmentPath: "_inbox/attachments",
	includeGroupMessages: true,
	pollIntervalSeconds: 5,
	autoStart: true,
	enableCommands: true,
	searchFolders: ["_inbox/processed", "inbox", "wiki"],
};

// --- Signal types ---

/** A Signal attachment from signal-cli JSON output. */
export interface SignalAttachment {
	contentType: string;
	filename?: string;
	id: string;
	size: number;
	width?: number;
	height?: number;
}

/** A parsed Signal message ready to be written to the vault. */
export interface SignalMessage {
	source: string;
	senderName: string;
	timestamp: number;
	body: string;
	attachments: SignalAttachment[];
	groupId: string | null;
	groupName: string | null;
	isOutgoing: boolean;
}

/**
 * Raw envelope shape from signal-cli JSON output.
 * JSON-RPC: {"jsonrpc":"2.0","method":"receive","params":{"envelope":{...}}}
 * Plain:    {"envelope":{...}}
 */
export interface SignalEnvelope {
	source?: string;
	sourceNumber?: string;
	sourceName?: string;
	sourceDevice?: number;
	timestamp?: number;
	serverReceivedTimestamp?: number;
	dataMessage?: {
		timestamp?: number;
		message?: string;
		attachments?: SignalAttachment[];
		groupInfo?: {
			groupId?: string;
			groupName?: string;
			type?: string;
		};
	};
	syncMessage?: {
		sentMessage?: {
			destination?: string;
			destinationNumber?: string;
			timestamp?: number;
			message?: string;
			attachments?: SignalAttachment[];
			groupInfo?: {
				groupId?: string;
				groupName?: string;
				type?: string;
			};
		};
	};
	typingMessage?: unknown;
	receiptMessage?: unknown;
}
