/** Bridge configuration loaded from config.json. */
export interface BridgeConfig {
	signalCli: {
		/** Path to signal-cli binary */
		path: string;
		/** Your Signal account phone number (e.g. "+1234567890") */
		account: string;
		/** signal-cli data directory (default: ~/.local/share/signal-cli) */
		configDir: string;
	};
	vault: {
		/** Absolute path to the inbox folder in your vault */
		inboxPath: string;
		/** Absolute path for storing attachments (images, files, voice) */
		attachmentPath: string;
	};
	/** Whether to capture group messages (default: true) */
	includeGroupMessages: boolean;
	/** Log level: "debug" | "info" | "warn" | "error" */
	logLevel: "debug" | "info" | "warn" | "error";
}

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
	/** Sender's phone number */
	source: string;
	/** Sender's profile name (if available) */
	senderName: string;
	/** Message timestamp (ms since epoch) */
	timestamp: number;
	/** Message body text (may be empty for attachment-only messages) */
	body: string;
	/** Attachments on this message */
	attachments: SignalAttachment[];
	/** Group ID if this is a group message */
	groupId: string | null;
	/** Group name if available */
	groupName: string | null;
	/** Whether this is a message we sent (synced from another device) */
	isOutgoing: boolean;
}

/**
 * Raw envelope shape from signal-cli JSON output.
 * signal-cli daemon mode wraps this in JSON-RPC:
 *   {"jsonrpc":"2.0","method":"receive","params":{"envelope":{...}}}
 * signal-cli receive mode outputs it directly:
 *   {"envelope":{...}}
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
