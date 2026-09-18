# YouTube Music Glass Synced Lyrics & PiP 🎵✨

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Version](https://img.shields.io/badge/Version-1.2.0-red.svg)](https://github.com/ankrypht/ytm-glass-lyrics)
[![Platform](https://img.shields.io/badge/Platform-macOS%20|%20Windows%20|%20Linux-brightgreen.svg)](https://github.com/ankrypht/ytm-glass-lyrics)
[![Compatibility](https://img.shields.io/badge/Browsers-Safari%20|%20Chrome%20|%20Brave%20|%20Edge%20|%20Firefox-orange.svg)](https://github.com/ankrypht/ytm-glass-lyrics)

A premium, universal userscript for [YouTube Music](https://music.youtube.com) that brings Apple Music-style frosted glass synchronized lyrics and a dedicated **Canvas Picture-in-Picture (PiP)** window to any desktop browser and operating system.

---

## ✨ Features

- 🪟 **Apple Music-Style Frosted Glass UI**
  - Sleek glassmorphism card with real-time blur (`backdrop-filter`) and ambient gradients.
  - Fully resizable and draggable with position/size persistence across sessions.
  - **Theatre Mode (Expanded View)** for an immersive full-height karaoke experience.
  - Quick-action controls: minimize (`–`), expanded view (`⛶`), settings modal (`⚙`), and PiP toggle.

- 🖼️ **Smooth Canvas Picture-in-Picture (PiP)**
  - Streams a dynamically rendered high-DPI canvas directly into your operating system's native Picture-in-Picture window.
  - Features real-time synchronized lyrics, ambient album glow, animated title marquee, and live progress bar.
  - Native PiP overlay controls allow pausing and resuming playback directly from the floating overlay.

- 🎨 **Adaptive Album Art Color Extraction**
  - Automatically samples the current song's album artwork to generate matching ambient background gradients and vibrant accent colors.
  - Built-in saturation filtering and luminance protection to guarantee high contrast and legibility.

- ⏱️ **Instant LRCLIB Integration & Time Calibration**
  - Queries [LRCLIB](https://lrclib.net/) for synchronized lyrics with multi-timestamp matching and millisecond accuracy.
  - $O(\log n)$ binary search lookup ensures zero frame drops or lag while seeking.
  - Click any lyric line to jump directly to that part of the song.
  - Fine-grained timing calibration slider ($\pm 2.0\text{s}$) to adjust for track mastering delays.

- 🛡️ **Truly Universal & Privacy-First**
  - Zero analytics, zero third-party telemetry, and zero tracking.
  - Built-in rate-limit protection and exponential backoff to respect community API limits.
  - Cross-platform keyboard shortcuts that do not hijack native browser navigation.

---

## 🌐 Compatibility Matrix

| Operating System | Supported Browsers                                     | Supported Userscript Runners                                      |
| :--------------- | :----------------------------------------------------- | :---------------------------------------------------------------- |
| **macOS**        | Safari, Chrome, Brave, Edge, Firefox, Opera, Vivaldi   | Userscripts (by Justin Wasack), Tampermonkey, Violentmonkey, Stay |
| **Windows**      | Chrome, Brave, Microsoft Edge, Firefox, Opera, Vivaldi | Tampermonkey, Violentmonkey, Greasemonkey 4                       |
| **Linux**        | Chrome, Chromium, Brave, Firefox, Edge                 | Tampermonkey, Violentmonkey, FireMonkey                           |

---

## 🚀 Installation

### Option 1: One-Click Install (Recommended)

1. Make sure you have a userscript manager installed in your browser:
   - **Safari (macOS / iOS)**: [Userscripts by Justin Wasack](https://apps.apple.com/app/userscripts/id1463298887)
   - **Chrome / Brave**: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
   - **Microsoft Edge**: [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
   - **Firefox**: [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
2. Install the userscript:
   - **From GitHub**: Click **[ytm-glass-lyrics.user.js](https://raw.githubusercontent.com/ankrypht/ytm-glass-lyrics/main/ytm-glass-lyrics.user.js)** and choose **Install**.
   - **From Greasy Fork**: [Install on Greasy Fork](https://greasyfork.org/en/scripts/596372-youtube-music-glass-synced-lyrics-pip).
3. Open [music.youtube.com](https://music.youtube.com) and play any track. The floating glass lyrics card will appear in the lower-right corner.

### Option 2: Manual Installation (Copy-Paste Method)

1. Install a userscript manager for your browser (see list in Option 1).
2. Open the userscript manager's dashboard and click "Create a new script".
3. Copy the contents of `ytm-glass-lyrics.user.js` and paste them into the editor.
4. Save the script.
5. Refresh YouTube Music.

---

## ⌨️ Keyboard Shortcuts

| Action                           | macOS Hotkey                       | Windows / Linux Hotkey                                                                                  |
| :------------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **Toggle Picture-in-Picture**    | <kbd>⌥ Option</kbd> + <kbd>P</kbd> | <kbd>Alt</kbd> + <kbd>P</kbd> _(or <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>)_                   |
| **Seek Forward 10 Seconds**      | <kbd>⌥ Option</kbd> + <kbd>→</kbd> | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>→</kbd> _(or <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>→</kbd>)_ |
| **Seek Backward 10 Seconds**     | <kbd>⌥ Option</kbd> + <kbd>←</kbd> | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>←</kbd> _(or <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>←</kbd>)_ |
| **Exit Expanded / Theatre Mode** | <kbd>Esc</kbd>                     | <kbd>Esc</kbd>                                                                                          |
| **Minimize / Restore Card**      | Double-click header                | Double-click header                                                                                     |

> [!NOTE]
> On Windows and Linux, seeking shortcuts use `Alt + Shift + Arrow` or `Ctrl + Alt + Arrow` to ensure the script never intercepts your standard browser history navigation (`Alt + Left/Right` = Back/Forward).

---

## ⚙️ Settings & Customization

Click the gear icon (**⚙**) on the floating card header to access user preferences:

- **Auto-Sync Colors with Album Art**: Dynamically alters the card theme to match the dominant and ambient tones of the playing song.
- **Custom Accent Color**: Choose a static highlight color when auto-sync is disabled.
- **Font Style**:
  - `System (SF Pro)`: Apple's native San Francisco typeface on macOS; modern system-ui (`Segoe UI` / `Roboto`) on Windows/Linux.
  - `Rounded`: Friendly rounded aesthetics (`SF Pro Rounded` on macOS, `Quicksand`/`Nunito` on Windows/Linux).
  - `Monospace`: Terminal aesthetic (`SF Mono` / `Menlo` / `Consolas`).
  - `Serif Editorial`: Classic publication aesthetic (`Georgia` / `New York`).
- **PiP Active Lyric Size**: Slider from `24px` to `44px` to customize readability for large desktop monitors.
- **In-App Lyrics Font Size**: Slider from `13px` to `22px` for comfortable reading in the floating card.
- **Timing Calibration (Offset)**: Fine-tune sync from `-2.0s` to `+2.0s` in 100ms increments.

---

## ❓ Troubleshooting & FAQ

### Firefox: PiP Button Says "Picture-in-Picture API is disabled"

Desktop Firefox does not expose the W3C programmatic `requestPictureInPicture` API to web pages by default (it uses its own browser overlay button).

- **To enable native video PiP API in Firefox**:
  1. Open a new tab and go to `about:config`.
  2. Accept the warning prompt.
  3. Search for: `media.videocontrols.picture-in-picture.video-element-pip.enabled`.
  4. Double-click to set it to `true`.
  5. Refresh YouTube Music.

### Brave Browser: Canvas Colors or PiP Not Loading

Brave Shields includes a fingerprinting protection feature ("farbling") that randomizes canvas pixel readouts.

- If album art colors appear muted or canvas PiP fails, click the Brave Shields lion icon in the address bar and set **Fingerprinting** to **Standard** (or disable Shields specifically for `music.youtube.com`).

### No Synced Lyrics Found for a Song

If a song is an instrumental or has not yet been transcribed on LRCLIB:

- The card displays an "Instrumental or No Lyrics" state.
- If static unsynced lyrics are available, the script renders them in clean plain-text format.
- Click **↻ Retry Lyrics** to clear the cache and force a new lookup.

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0). See the [LICENSE](./LICENSE) file for details.

---

**Made with ❤️ for music lovers.** Feedback and issues are welcome on [GitHub Issues](https://github.com/ankrypht/ytm-glass-lyrics/issues).
