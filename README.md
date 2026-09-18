# YouTube Music Glass Synced Lyrics & PiP 🎵✨

[![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-Install-red.svg?logo=greasemonkey)](https://greasyfork.org/en/scripts/596372-youtube-music-glass-synced-lyrics-pip)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Platform-macOS%20(Safari)-black.svg?logo=apple)](https://github.com/ankrypht/ytm-glass-lyrics)
[![Extension](https://img.shields.io/badge/Extension-Userscripts%20by%20Justin%20Wasack-orange.svg)](https://apps.apple.com/app/userscripts/id1463298887)
[![Version](https://img.shields.io/badge/Version-1.2.0-blue.svg)](https://github.com/ankrypht/ytm-glass-lyrics)

An Apple Music-inspired synchronized lyrics and **Canvas Picture-in-Picture (PiP)** userscript built specifically for **macOS** with **Safari** (and Safari Web Apps / PWA) using the **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** extension by Justin Wasack.

---

## ✨ Features

- 🪟 **Apple Music-Style Frosted Glass UI**
  - Ultra-sleek glassmorphism overlay using native `-webkit-backdrop-filter: blur(32px) saturate(210%)`.
  - Fully resizable, draggable, and persists position/size across restarts.
  - **Theatre Mode (Expanded View)** for full-height karaoke lyrics overlay.
  - Double-click header to collapse or restore (standard macOS window behavior).

- 🖼️ **Native WebKit Picture-in-Picture (PiP)**
  - Streams a dynamically rendered high-DPI 520×520 canvas directly into macOS native Picture-in-Picture using WebKit presentation mode.
  - Features real-time synchronized lyrics, ambient album glow, animated title marquee, and live progress bar.
  - Full support for native PiP play/pause controls.
  - Intelligent background auto-resume: automatically restores track playback if Safari momentarily pauses background audio upon closing PiP.

- 🎨 **Adaptive Album Art Color Extraction**
  - Automatically samples the playing song's album artwork via cross-origin blob extraction.
  - Calculates dominant saturation and ambient dark-tone luminance to build custom gradients and accents that match each track.

- 🍎 **Native Apple Typography**
  - Designed natively around Apple system typefaces: `SF Pro Display`, `SF Pro Text`, `SF Pro Rounded`, and `SF Mono`.
  - Battery-conscious render loop capped to 30fps to avoid wasting energy on 120Hz ProMotion displays.

- ⏱️ **Synchronized LRCLIB Integration**
  - Queries [LRCLIB](https://lrclib.net/) for synchronized lyrics with multi-timestamp matching and millisecond accuracy.
  - $O(\log n)$ binary search lookup ensures zero frame drops or lag while seeking.
  - Click any lyric line to jump directly to that part of the song.
  - Fine-grained timing calibration slider ($\pm 2.0\text{s}$) to adjust for track mastering delays.

- 🛡️ **Privacy-First & Lightweight**
  - Zero third-party trackers, zero analytics, and zero telemetry.
  - Local caching in `localStorage` prevents duplicate network requests on replay.

---

## 💻 Requirements

- **Operating System**: macOS (Ventura, Sonoma, Sequoia, or later)
- **Browser**: Apple Safari (or Safari Web App / "Add to Dock" PWA)
- **Userscript Runner**: [Userscripts by Justin Wasack](https://apps.apple.com/app/userscripts/id1463298887) (Free & Open Source on the Mac App Store)

---

## 🚀 Setup & Installation (Safari on macOS)

### Step 1: Install & Enable 'Userscripts' Extension
1. Download and install **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** from the Mac App Store.
2. Open Safari and navigate to **Safari → Settings (⌘,) → Extensions**.
3. Check the box to enable **Userscripts**.
4. Click **Permissions** and ensure permissions for `music.youtube.com` are set to **Always Allow**.

---

### Step 2: Install the Script

#### Method 1: Greasy Fork (Recommended) ⭐
> [!TIP]
> **Why Greasy Fork is Recommended over GitHub:**
> Installing via Greasy Fork automatically bundles update metadata (`@updateURL` and `@downloadURL`). This allows the **Userscripts** extension to automatically detect, notify, and install updates in the background whenever a new version is released. 
> 
> Direct installs from raw GitHub links do not automatically register update hooks in the Userscripts extension, requiring manual re-downloads when new features are added.

1. Go to the script page on **[Greasy Fork](https://greasyfork.org/en/scripts/596372-youtube-music-glass-synced-lyrics-pip)**.
2. Click the green **Install this script** button.
3. The Userscripts extension prompt will appear. Click **Install**.
4. Open [music.youtube.com](https://music.youtube.com) and play any track. The frosted glass card will appear in the bottom-right corner!

#### Method 2: Direct Install from GitHub (Alternative)
If you prefer installing directly from source:
1. Navigate to [music.youtube.com](https://music.youtube.com) in Safari.
2. Click the **Userscripts** icon (`</>`) in your Safari toolbar.
3. Click the **+** (New Script) button.
4. Copy and paste the entire contents of **[ytm-glass-lyrics.user.js](https://raw.githubusercontent.com/ankrypht/ytm-glass-lyrics/main/ytm-glass-lyrics.user.js)** into the editor.
5. Press <kbd>⌘ Command</kbd> + <kbd>S</kbd> to save.

*(Optional: If you use YouTube Music as a Safari Web App via **File → Add to Dock**, ensure the Userscripts extension is allowed in your Web App profile).*

---

## ⌨️ macOS Keyboard Shortcuts

| Action | Shortcut |
| :--- | :--- |
| **Pop Out Picture-in-Picture (PiP)** | <kbd>⌥ Option</kbd> + <kbd>P</kbd> |
| **Seek Forward 10 Seconds** | <kbd>⌥ Option</kbd> + <kbd>→</kbd> |
| **Seek Backward 10 Seconds** | <kbd>⌥ Option</kbd> + <kbd>←</kbd> |
| **Exit Expanded / Theatre Mode** | <kbd>Esc</kbd> |
| **Minimize / Restore Card** | Double-click header |

---

## ⚙️ Settings & Customization

Click the gear icon (**⚙**) on the floating glass card header to customize:

- **Auto-Sync Colors with Album Art**: Dynamically themes the interface using the album artwork palette.
- **Custom Accent Color**: Choose a static accent color when auto-sync is disabled.
- **Font Style**:
  - `System (SF Pro)`: Apple's San Francisco typeface.
  - `Rounded`: Friendly `SF Pro Rounded`.
  - `Monospace`: Code-style `SF Mono`.
  - `Serif Editorial`: Classic `New York` / `Georgia`.
- **PiP Active Lyric Size**: Slider from `24px` to `44px` to adjust Picture-in-Picture legibility.
- **In-App Lyrics Font Size**: Slider from `13px` to `22px` for comfortable reading in the floating card.
- **Timing Calibration (Offset)**: Fine-tune lyric sync between `-2.0s` and `+2.0s` in 100ms increments.

---

## ❓ FAQ & Troubleshooting

### Picture-in-Picture doesn't open
- Ensure you have clicked into the YouTube Music tab at least once (Safari requires a user gesture before video presentation modes can activate).
- You can also click the **⤢ Pop Out** button directly in the card header.

### Closing PiP resumes music when I wanted it paused
- Safari momentarily pauses background media streams when a PiP window is dismissed. The script includes an auto-resume safeguard if the track was playing within 1.5s prior to closing. If you wish to keep playback paused, pause the music first and wait 2 seconds before closing PiP.

### Lyrics not found for a track
- Instrumental tracks or newly released songs may not yet be in LRCLIB.
- The card will display an "Instrumental or No Lyrics" screen.
- Click **↻ Retry Lyrics** to clear the cached negative result and query the API again.

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0). See the [LICENSE](file:///Users/ankushsarkar/Programming/YTM/LICENSE) file for details.

---

**Made with ❤️ for macOS & Safari.** Issues and feature requests are welcome on [GitHub Issues](https://github.com/ankrypht/ytm-glass-lyrics/issues).
