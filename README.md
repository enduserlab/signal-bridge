# Signal Bridge

Obsidian plugin that receives Signal messages via [signal-cli](https://github.com/AsamK/signal-cli) and writes them as markdown notes into your vault. Works as a companion to the [Signal Inbox](https://github.com/enduserlab/signal-inbox) plugin for automatic classification.

Also supports **bidirectional commands** — text `/help` to yourself on Signal to search your vault, check status, and save quick notes from anywhere.

## Prerequisites

- **signal-cli 0.13+** installed and linked ([github.com/AsamK/signal-cli](https://github.com/AsamK/signal-cli))
- **Java 21+** (required by signal-cli)

## Setup

### 1. Install signal-cli

```bash
brew install signal-cli    # macOS
# or download from https://github.com/AsamK/signal-cli/releases
```

### 2. Install Java (if needed)

```bash
brew install openjdk@21
```

### 3. Link as a secondary device

This is safe — it's the same as adding Signal Desktop.

```bash
signal-cli link -n "Obsidian"
# Scan the QR code on your phone: Signal → Settings → Linked Devices
```

### 4. Configure the plugin

Open **Settings → Signal Bridge** in Obsidian:
- Enter your phone number
- Verify the signal-cli path
- Set your inbox folder (default: `_inbox/signal`)

The bridge starts automatically. You'll see "Signal: Listening" in the status bar.

## How it works

```
Signal → signal-cli → plugin → vault markdown
                                     ↓
                            Signal Inbox plugin
                                     ↓
                          classified & filed notes
```

1. **Signal Bridge** polls signal-cli for new messages
2. Each message becomes a markdown file with YAML frontmatter
3. **Signal Inbox** (optional companion plugin) picks them up, classifies with Claude, and files them

## Commands

Text these to yourself on Signal (Note to Self):

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/search <query>` | Search your vault for matching notes |
| `/recent [n]` | Show the n most recent classified messages |
| `/status` | Show bridge and inbox stats |
| `/note <text>` | Save a quick note to the inbox |

## Output format

Each message becomes a markdown file with rich frontmatter:

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

# Message from Alice

Check out this article: https://example.com/article
```

Filename format: `Sender - YYYY-MM-DD - HHMMSS.md`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Signal account | — | Your phone number in international format |
| signal-cli path | `signal-cli` | Path to the signal-cli binary |
| Config directory | auto-detect | signal-cli data directory |
| Inbox folder | `_inbox/signal` | Where incoming messages are written |
| Attachment folder | `_inbox/attachments` | Where media files are stored |
| Auto-start | on | Start listening when Obsidian launches |
| Group messages | on | Capture messages from Signal groups |
| Poll interval | 5s | How often to check for new messages |
| Commands | on | Respond to /commands via Note to Self |

## Network disclosure

This plugin spawns **signal-cli** as a local process to communicate with the Signal network. It does not make any other network requests. All message data stays on your machine.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
