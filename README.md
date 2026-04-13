# Signal Bridge

Companion service for the [Signal Inbox](https://github.com/danielquinn/signal-inbox) Obsidian plugin. Receives Signal messages via signal-cli and writes them as markdown files into your vault's inbox folder.

Also supports **bidirectional commands** — text `/help` to yourself on Signal to search your vault, check status, and save quick notes.

## Prerequisites

- **Node.js 18+**
- **signal-cli 0.13+** installed and linked ([github.com/AsamK/signal-cli](https://github.com/AsamK/signal-cli))
- **Java 21+** (required by signal-cli)

## Quick start

```bash
# 1. Install signal-cli
brew install signal-cli    # macOS

# 2. Link as a secondary device (safe — like adding Signal Desktop)
signal-cli link -n "obsidian-bridge"
# Scan the QR code on your phone: Signal → Settings → Linked Devices

# 3. Set up the bridge
cd signal-bridge
npm install
cp config.example.json config.json
# Edit config.json with your phone number and vault path

# 4. Build and run
npm run build
npm start
```

## Configuration

```json
{
  "signalCli": {
    "path": "signal-cli",
    "account": "+1234567890",
    "configDir": "~/.local/share/signal-cli"
  },
  "vault": {
    "inboxPath": "/path/to/your/vault/_inbox/signal",
    "attachmentPath": "/path/to/your/vault/_inbox/attachments"
  },
  "includeGroupMessages": true,
  "logLevel": "info"
}
```

| Field | Description |
|-------|-------------|
| `signalCli.path` | Path to signal-cli binary |
| `signalCli.account` | Your Signal phone number |
| `signalCli.configDir` | signal-cli data directory |
| `vault.inboxPath` | Where to write message markdown files |
| `vault.attachmentPath` | Where to copy Signal attachments (images, files, voice) |
| `includeGroupMessages` | Whether to capture group messages |
| `logLevel` | `debug`, `info`, `warn`, or `error` |

## Commands

Text these to yourself on Signal (Note to Self) while the bridge is running:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/search <query>` | Search your vault for matching messages |
| `/recent [n]` | Show the n most recent classified messages |
| `/status` | Show bridge and inbox stats |
| `/note <text>` | Save a quick note to the inbox |

## Output format

Each message becomes a markdown file:

```
2026-04-12_200000_Alice.md
2026-04-12_200130_FamilyChat_Bob.md
```

With rich YAML frontmatter:

```yaml
---
sender: "Alice"
source: "+1234567890"
timestamp: 1712956800000
date: "2026-04-12T20:00:00.000Z"
type: "signal-message"
urls:
  - "https://example.com/article"
has-attachments: true
attachment-types:
  - "image/jpeg"
---
```

The Signal Inbox Obsidian plugin picks these up and handles classification.

## Deployment

### Local (same machine as Obsidian)

Just run the bridge. It writes directly to your vault.

```bash
npm start
```

### systemd service (Linux/server)

```ini
# /etc/systemd/system/signal-bridge.service
[Unit]
Description=Signal Bridge for Obsidian
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/opt/signal-bridge
ExecStart=/usr/bin/node dist/index.js /opt/signal-bridge/config.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now signal-bridge
```

### launchd (macOS)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.signal-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/signal-bridge/dist/index.js</string>
        <string>/opt/signal-bridge/config.json</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/signal-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/signal-bridge.err</string>
</dict>
</plist>
```

Save to `~/Library/LaunchAgents/com.user.signal-bridge.plist` and load with:

```bash
launchctl load ~/Library/LaunchAgents/com.user.signal-bridge.plist
```

## Development

```bash
npm run dev    # watch mode with tsx
```

## License

MIT
