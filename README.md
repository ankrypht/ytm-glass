# YouTube Music Glass: Apple Redesign, Synced Lyrics & PiP 🎵✨

[![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-Install-red.svg?logo=greasemonkey)](https://greasyfork.org/en/scripts/596372-youtube-music-glass-apple-redesign-synced-lyrics-pip)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%28Safari%29-black.svg?logo=apple)](https://github.com/ankrypht/ytm-glass)
[![Extension](https://img.shields.io/badge/Extension-Userscripts%20by%20Justin%20Wasack-orange.svg)](https://apps.apple.com/app/userscripts/id1463298887)
[![Version](https://img.shields.io/badge/Version-2.1.1-blue.svg)](https://github.com/ankrypht/ytm-glass)

A complete **Apple Music-inspired frosted glass redesign**, dynamic ambient mesh backdrop, synchronized lyrics, and **Canvas Picture-in-Picture (PiP)** userscript built specifically for **macOS** with **Safari** (and Safari Web Apps / PWA) using the **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** extension by Justin Wasack.

---

## 📸 Preview & Showcase

### 🎨 Apple Music-Style Frosted Glass Player & Synced Lyrics
The player screen completely overhauled into an Apple Music desktop experience. Features real-time dynamic ambient mesh gradients derived from the active album artwork, a floating frosted glass side panel (`#side-panel`), pixel-perfect vertical alignment with the album artwork, and synchronized auto-scrolling lyrics with active glowing text directly inside YouTube Music's native **LYRICS** tab.

[![YouTube Music Glass Player Screen & Synced Lyrics](https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/player-screen-synced-lyrics.png)](https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/player-screen-synced-lyrics.png)

---

### 🖼️ System-Wide Picture-in-Picture (PiP) Multitasking
Multitask anywhere across macOS while keeping synchronized lyrics in view. The native WebKit Picture-in-Picture window streams a high-DPI dynamic canvas with real-time scrolling lyrics, glowing highlights, track metadata, and a live progress bar.

[![macOS Desktop Picture-in-Picture Synced Lyrics](https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/macos-desktop-pip.png)](https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/macos-desktop-pip.png)

---

### 🎵 Canvas Picture-in-Picture Card (Detail View)
A closer look at the dedicated 520×520 Canvas PiP interface: Apple system typography (`SF Pro`), smooth ambient background glow matching the album art palette, glowing active lyric line emphasis, and live playback time scrubber.

<p align="center">
  <a href="https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/pip-synced-lyrics-widget.png">
    <img src="https://raw.githubusercontent.com/ankrypht/ytm-glass/main/screenshots/pip-synced-lyrics-widget.png" alt="Picture-in-Picture Lyrics Widget" width="460" />
  </a>
</p>

---

## 🌟 What's New in v2.1 & v2.0

Originally created as a standalone synced lyrics and Picture-in-Picture tool, **v2.0 transformed YouTube Music into a full-fledged Apple Music desktop experience**, with **v2.1 adding key performance and layout refinements**:

- ⚡ **Battery & CPU Optimization (v2.1.1)**: Halts background canvas render loops and intervals when PiP is closed, eliminating ~500k idle timer wakes per hour on macOS Safari.
- 📐 **Pixel-Perfect Alignment & Proportions (v2.1.0)**: Dynamic height synchronization between album art and side panel via a high-performance `ResizeObserver`. Top edges, bottom edges, and vertical centers align identically with zero video collisions on widescreen media.
- 🎨 **Complete Player Screen Overhaul**: Real-time ambient mesh gradients extracted from active album artwork, soft glowing artwork halo lighting, and a floating frosted glass side panel (`#side-panel`).
- 🪟 **Home Screen & Navigation Glass Polish**: Edge-to-edge frosted glass top navigation bar (`ytmusic-nav-bar`), sleek blurred category pill chips, translucent left sidebar guide, and rounded album artwork cards.
- 🎵 **Integrated Native Tab Lyrics**: Synchronized, clickable, auto-scrolling lyrics directly inside YouTube Music's native **LYRICS** tab—no intrusive floating overlays.
- 🚫 **Edge-to-Edge Fluidity**: Suppresses native right-side scrollbar gutters for seamless, edge-to-edge glass visuals across both regular Safari windows and standalone PWA desktop apps.

---

## ✨ Features

- 🪟 **Apple Music-Style Frosted Glass & Dynamic Theming (Home & Player Screens)**
  - Full-app dynamic color extraction: seamlessly bathes both the **Home Screen** and **Player Screen** in radiant ambient mesh gradients derived from the active album art.
  - Transparent browse containers allow the dynamic album glow to shine through browsing sections, category chips, and playlists.
  - Frosted glass navigation bar, glowing category pills, glass sidebar, and smooth card hover lifts.
  - **Pixel-Perfect Player Screen Layout & Vertical Alignment**:
    - Right side panel (`#side-panel`) dynamically synchronizes its rendered height with the song artwork using a high-performance `ResizeObserver`, ensuring top edges, bottom edges, and vertical centers align identically.
    - Symmetrical, balanced padding across all four sides in both maximized (fill) and floating/resized PWA window modes.
    - Zero video collisions: bounded layout constraints prevent widescreen (16:9) music videos from expanding into or touching the right-side tabs panel, maintaining a clean, fluid gap.
  - Integrated synchronized lyrics directly inside the native **LYRICS** tab—no floating window overlays.
  - Soft ambient halo lighting behind album artwork and dynamic backdrop mesh.
  - Frosted glass side panel, translucent tab bar with glowing active indicator, and glass player controls.
  - Quick-jump floating pill (`↓ Current Lyric`) when scrolling through lyrics.

- 🖼️ **Native WebKit Picture-in-Picture (PiP)**
  - Streams a dynamically rendered high-DPI 520×520 canvas directly into macOS native Picture-in-Picture using WebKit presentation mode.
  - Features real-time synchronized lyrics, ambient album glow, animated title marquee, and live progress bar.
  - Full support for native PiP play/pause controls.
  - Intelligent background auto-resume: automatically restores track playback if Safari momentarily pauses background audio upon closing PiP.

- 🎨 **Adaptive Album Art Color Extraction**
  - Automatically samples the playing song's album artwork via cross-origin blob extraction.
  - Calculates dominant saturation and ambient dark-tone luminance to build custom gradients, ambient backdrop glow, and accents that match each track.

- 🍎 **Native Apple Typography & Battery Efficiency**
  - Designed natively around Apple system typefaces: `SF Pro Display`, `SF Pro Text`, `SF Pro Rounded`, and `SF Mono`.
  - Battery-conscious render loop: pauses canvas rendering completely when PiP is closed, capped to 30fps during active playback to preserve energy on 120Hz ProMotion displays.

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

1. Go to the script page on **[Greasy Fork](https://greasyfork.org/en/scripts/596372-youtube-music-glass-apple-redesign-synced-lyrics-pip)**.
2. Click the green **Install this script** button.
3. The Userscripts extension prompt will appear. Click **Install**.
4. Open [music.youtube.com](https://music.youtube.com) and play any track. The player screen will be styled with dynamic frosted glass and synced lyrics will be waiting in the **LYRICS** tab!

#### Method 2: Direct Install from GitHub (Alternative)

If you prefer installing directly from source:

1. Navigate to [music.youtube.com](https://music.youtube.com) in Safari.
2. Click the **Userscripts** icon (`</>`) in your Safari toolbar.
3. Click the **+** (New Script) button.
4. Copy and paste the entire contents of **[ytm-glass.user.js](https://raw.githubusercontent.com/ankrypht/ytm-glass/main/ytm-glass.user.js)** into the editor.
5. Press <kbd>⌘ Command</kbd> + <kbd>S</kbd> to save.

_(Optional: If you use YouTube Music as a Safari Web App via **File → Add to Dock**, ensure the Userscripts extension is allowed in your Web App profile)._

---

## ⌨️ macOS Keyboard Shortcuts

| Action                               | Shortcut                           |
| :----------------------------------- | :--------------------------------- |
| **Pop Out Picture-in-Picture (PiP)** | <kbd>⌥ Option</kbd> + <kbd>P</kbd> |
| **Seek Forward 10 Seconds**          | <kbd>⌥ Option</kbd> + <kbd>→</kbd> |
| **Seek Backward 10 Seconds**         | <kbd>⌥ Option</kbd> + <kbd>←</kbd> |
| **Close Settings Modal**             | <kbd>Esc</kbd>                     |

---

## ⚙️ Settings & Customization

Click the gear icon (**⚙**) on the lyrics tab header to customize:

- **Auto-Sync Colors with Album Art**: Dynamically themes the interface and ambient background using the album artwork palette.
- **Custom Accent Color**: Choose a static accent color when auto-sync is disabled.
- **Font Style**:
  - `System (SF Pro)`: Apple's San Francisco typeface.
  - `Rounded`: Friendly `SF Pro Rounded`.
  - `Monospace`: Code-style `SF Mono`.
  - `Serif Editorial`: Classic `New York` / `Georgia`.
- **PiP Active Lyric Size**: Slider from `24px` to `44px` to adjust Picture-in-Picture legibility.
- **Lyrics Font Size**: Slider from `14px` to `26px` for comfortable in-app reading.
- **Timing Calibration (Offset)**: Fine-tune lyric sync between `-2.0s` and `+2.0s` in 100ms increments.

---

## ❓ FAQ & Troubleshooting

### Picture-in-Picture doesn't open

- Ensure you have clicked into the YouTube Music tab at least once (Safari requires a user gesture before video presentation modes can activate).
- You can also click the **⤢ Pop Out** button directly in the lyrics tab header.

### Closing PiP resumes music when I wanted it paused

- Safari momentarily pauses background media streams when a PiP window is dismissed. The script includes an auto-resume safeguard if the track was playing within 1.5s prior to closing. If you wish to keep playback paused, pause the music first and wait 2 seconds before closing PiP.

### Lyrics not found for a track

- Instrumental tracks or newly released songs may not yet be in LRCLIB.
- The lyrics tab will display an "Instrumental or No Lyrics" screen.
- Click **↻ Retry Lyrics** to clear the cached negative result and query the API again.

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0). See the [LICENSE](https://github.com/ankrypht/ytm-glass/blob/main/LICENSE) file for details.

---

**Made with ❤️ for macOS & Safari.** Issues and feature requests are welcome on [GitHub Issues](https://github.com/ankrypht/ytm-glass/issues).
