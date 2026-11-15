# Twitch Raid Tracker

Chrome extension that remembers the raids you were part of on Twitch, so you can see if and how you got to a channel
before.

## Features

- **Raid tracking**: when Twitch redirects you to another channel because of a raid, the raid is saved (source, target,
  time).
- **Raids seen in chat** (optional): raids arriving at the channel you are watching are detected from the raid message
  in chat, including the number of raiders.
- **Tooltip on twitch.tv**: hovering a channel link shows how often you were raided to that channel and the latest raids.
- **Badge**: the extension icon shows how often you were raided to the channel of the current tab.
- **Popup**
    - History: searchable list of all raids, filter by period, channel names link to the channel, single raids can be
      deleted.
    - Stats: number of raids, most frequent raid sources and targets, raids per month.
    - Summary of the channel you are currently watching.
- **Data management**: export and import the raids as JSON, delete everything, optional automatic deletion of old raids.

Popup and options follow the light or dark setting of your browser.

All data stays in the local storage of your browser. Nothing is sent anywhere.

## Installation

The extension is loaded unpacked:

1. Download or clone this repository.
2. Open `chrome://extensions` and enable the developer mode.
3. Click "Load unpacked" and select the folder of this repository.

## Options

Open the options with the button in the top right corner of the popup.

| Option | Default | Description |
|---|---|---|
| Track raids seen in chat | off | Detects raids arriving at the channel you are watching from the raid message in chat. |
| Delete old raids after | 0 | Raids older than this number of months are deleted, 0 keeps them forever. |
| Count raids seen in chat | off | Raids seen in chat also count for the tooltip and the badge. |
| Raid count on the extension icon | on | Badge with the number of raids to the channel of the current tab. |
| Raids in the tooltip on twitch.tv | 5 | Number of raids listed in the tooltip. |
| Raids per page in the popup | 15 | Page size of the history in the popup. |
| Debug logging | off | Writes detailed logs to the console of the page, popup and service worker. |

### Raids seen in chat

Twitch shows the raid message in the language of your Twitch interface. Supported languages are English and German.
To add a language, add a pattern to `raidMessagePatterns` in `content/shared.js`. With debug logging enabled, every
notice Twitch adds to the chat is logged with its text, which shows the wording to match.

## Data format

The export is a JSON array of raids:

```json
[
    {
        "uuid": "0b0e0c1e-4c57-4a39-9a43-0a6a3a3f7a11",
        "source": "raiding_channel",
        "target": "raided_channel",
        "timestamp": "2026-09-08T12:00:00.000Z",
        "dataOrigin": "raid",
        "viewers": 42
    }
]
```

- `dataOrigin` is `raid` (you were redirected) or `chat` (seen in chat).
- `viewers` is the number of raiders and only known for raids seen in chat.
- On import `uuid`, `dataOrigin` and `viewers` are optional, entries without a valid `source`, `target` and
  `timestamp` are skipped.

## Development

There is no build step. The logic shared by all parts of the extension is in `content/shared.js` and covered by tests
that run with Node.js 22 or newer:

```bash
npm test
```

| Path | Purpose |
|---|---|
| `content/tracker/active_raid_tracker.js` | Service worker: detects raid redirects, sets the badge. |
| `content/tracker/passive_raid_tracker.js` | Content script: detects raid messages in chat. |
| `content/tooltip/` | Content script: tooltip on channel links. |
| `content/popup.html`, `content/popup.js` | Popup with history and stats. |
| `content/options/` | Options page. |
| `content/shared.js` | Shared functions and defaults. |
| `content/theme.css` | Colors and basic styles of popup and options page. |
| `other_resources/dummy_raid_data_bkp.json` | Example data for the import. |

## License

See [LICENSE](LICENSE).
