import { loadConfig } from "./config.js";
import { SignalListener } from "./signal.js";
import { MessageWriter } from "./writer.js";
import { isCommand, handleCommand, sendSelfResponse } from "./commands.js";

const configPath = process.argv[2];
const config = loadConfig(configPath);

const listener = new SignalListener(config);
const writer = new MessageWriter(config);

let messageCount = 0;
let commandCount = 0;

listener.on("message", async (message) => {
	try {
		// Check if this is a command from the user
		if (isCommand(message)) {
			commandCount++;
			const ts = new Date().toISOString();
			console.log(`[${ts}] [INFO] Command: ${message.body.trim()}`);

			const response = await handleCommand(message, config);
			await sendSelfResponse(response, config);

			console.log(`[${ts}] [INFO] Response sent (${response.length} chars)`);
			return;
		}

		// Otherwise, write it as a regular message
		writer.write(message);
		messageCount++;
	} catch (err) {
		console.error(`[ERROR] Failed to process message:`, err);
	}
});

listener.on("error", (err) => {
	console.error(`[ERROR] Signal listener error:`, err);
});

listener.on("close", (code) => {
	if (code !== 0 && code !== null) {
		console.error(`[ERROR] signal-cli exited unexpectedly (code ${code}). Restarting in 5s...`);
		setTimeout(() => listener.start(), 5000);
	}
});

// Graceful shutdown
function shutdown(signal: string): void {
	console.log(`\n[INFO] Received ${signal}. Shutting down... (${messageCount} messages, ${commandCount} commands processed)`);
	listener.stop();
	process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Start
console.log(`
  Signal Bridge v0.1.0
  Account:  ${config.signalCli.account}
  Inbox:    ${config.vault.inboxPath}
  Groups:   ${config.includeGroupMessages ? "included" : "excluded"}
  Commands: enabled (text /help to yourself)
`);

listener.start();
