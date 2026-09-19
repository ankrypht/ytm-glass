// ==UserScript==
// @name         YouTube Music Glass: Apple Redesign, Synced Lyrics & PiP
// @namespace    https://github.com/ankrypht/ytm-glass
// @version      2.1.0
// @description  Apple Music-inspired frosted glass redesign, dynamic ambient mesh glow, synchronized lyrics & native Picture-in-Picture for YouTube Music on Safari (macOS).
// @author       ankrypht
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/ankrypht/ytm-glass
// @supportURL   https://github.com/ankrypht/ytm-glass/issues
// @icon         https://music.youtube.com/img/favicon_144.png
// @compatible   safari macOS (tested with Userscripts extension by Justin Wasack)
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      lrclib.net
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // 1. Persistent Configuration
  const PREFS_KEY = 'ytm_lyrics_custom_prefs';
  const defaultPrefs = {
    syncAlbumArt: true,
    accentColor: '#ff284d',
    bgStart: '#06050b',
    bgEnd: '#13101c',
    fontFamily: 'system',
    pipFontSize: 32,
    lyricsFontSize: 18,
    timeOffsetMs: 0
  };

  let prefs = Object.assign({}, defaultPrefs);
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.pwaFontSize && !parsed.lyricsFontSize) {
        parsed.lyricsFontSize = parsed.pwaFontSize;
      }
      prefs = Object.assign({}, defaultPrefs, parsed);
    }
  } catch (e) {}

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
    applyTheme();
    drawPiPFrame();
  }

  let activeTheme = {
    accent: prefs.accentColor,
    bgStart: prefs.bgStart,
    bgEnd: prefs.bgEnd
  };

  // State Management
  let currentKey = '';
  let lyricsData = [];
  let lyricState = 'idle'; // 'idle' | 'searching' | 'found' | 'plain' | 'empty' | 'rate_limited'
  let currentSong = { title: '', artist: '', artwork: '', duration: 0 };
  let pipVideo = null;
  let canvas = null;
  let ctx = null;
  let isPipActive = false;
  let lastActiveIdx = -1;
  let cachedDomRows = [];
  let isUserScrolling = false;
  let userScrollTimeout = null;
  let lastPlayingTimestamp = 0;
  let sidePanelResizeObserver = null;

  // Rate Limiting & Request Tokens
  let activeRequestId = 0;
  let activeRequestHandle = null;
  let rateLimitUntil = 0;
  let rateLimitTimer = null;

  // In-Memory & Persistent Caches
  const lyricsMemoryCache = new Map();
  const paletteCache = new Map();
  let lastExtractedUrl = '';
  const PERSISTENT_CACHE_KEY = 'ytm_lyrics_cache_v2';
  const MAX_PERSISTENT_ENTRIES = 100;

  function loadPersistentCache() {
    try {
      const raw = localStorage.getItem(PERSISTENT_CACHE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        Object.keys(obj).forEach(k => {
          lyricsMemoryCache.set(k, obj[k]);
        });
      }
    } catch (e) {}
  }
  loadPersistentCache();

  function saveToLyricsCache(key, data) {
    if (!key) return;
    lyricsMemoryCache.set(key, data);
    try {
      const obj = {};
      // Keep most recent entries
      const entries = Array.from(lyricsMemoryCache.entries()).slice(-MAX_PERSISTENT_ENTRIES);
      entries.forEach(([k, v]) => { obj[k] = v; });
      localStorage.setItem(PERSISTENT_CACHE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function getCacheKey(title, artist) {
    return `${cleanTrackTitle(title, artist).toLowerCase()}___${getPrimaryArtist(artist).toLowerCase()}`;
  }

  // Utility Functions
  function colorWithAlpha(colorStr, alpha) {
    if (!colorStr) return `rgba(255, 40, 77, ${alpha})`;
    if (colorStr.startsWith('#')) {
      let c = colorStr.slice(1);
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const r = parseInt(c.slice(0, 2), 16) || 0;
      const g = parseInt(c.slice(2, 4), 16) || 0;
      const b = parseInt(c.slice(4, 6), 16) || 0;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (colorStr.startsWith('rgb')) {
      const m = colorStr.match(/\d+/g);
      if (m && m.length >= 3) {
        return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
      }
    }
    return colorStr;
  }

  function getCanvasFont(weight, size) {
    const f = prefs.fontFamily;
    if (f === 'rounded') return `${weight} ${size}px "SF Pro Rounded", system-ui, sans-serif`;
    if (f === 'mono') return `${weight} ${size}px "SF Mono", Menlo, monospace`;
    if (f === 'serif') return `${weight} ${size}px Georgia, "Times New Roman", serif`;
    return `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
  }

  function getCSSFont() {
    const f = prefs.fontFamily;
    if (f === 'rounded') return '"SF Pro Rounded", system-ui, sans-serif';
    if (f === 'mono') return '"SF Mono", Menlo, monospace';
    if (f === 'serif') return 'Georgia, "Times New Roman", serif';
    return 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function getYTMVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.find(v => v !== pipVideo && v.classList.contains('html5-main-video')) ||
           videos.find(v => v !== pipVideo) || null;
  }

  function getYTMPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function toggleYTMPlayback(play) {
    const player = getYTMPlayer();
    const video = getYTMVideo();
    if (play) {
      if (player && typeof player.playVideo === 'function') {
        player.playVideo();
      } else if (video) {
        video.play().catch(() => {});
      }
    } else {
      if (player && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
      } else if (video) {
        video.pause();
      }
    }
  }

  // Clean Track Title & Artist
  function cleanTrackTitle(rawTitle, artist = '') {
    if (!rawTitle) return '';
    let t = rawTitle;

    // If title begins with "Artist - Song", strip the redundant artist prefix
    if (artist) {
      const artEscaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixRegex = new RegExp('^' + artEscaped + '\\s*-\\s*', 'i');
      t = t.replace(prefixRegex, '');
    }

    // Iteratively strip bracketed tags: (Official Music Video), [Lyric Video], (feat. ...), [4K], etc.
    const bracketRegex = /\s*[\(\[][^()\[\]]*(?:official|music\s*video|audio|video|lyric|remaster|deluxe|edition|visualizer|live|feat\.?|ft\.?|performance|hd|4k|prod\.)[^()\[\]]*[\)\]]/gi;
    let prev;
    do {
      prev = t;
      t = t.replace(bracketRegex, '');
    } while (t !== prev);

    // Strip trailing hyphen descriptors e.g. " - Remastered 2011", " - Official Video"
    t = t.replace(/\s*-\s*(?:remastered(?:\s*\d+)?|radio\s*edit|live(?:\s*at\s*.*)?|single\s*version|bonus\s*track|official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|visualizer|lyric\s*video|lyrics?).*/gi, '');

    // Strip trailing unbracketed "feat. XYZ" / "ft. XYZ"
    t = t.replace(/\s*(?:feat\.?|ft\.?)\s+.*/gi, '');

    // Normalize quotes & trim
    t = t.replace(/["“”'‘’]/g, '').trim();
    return t;
  }

  function getPrimaryArtist(rawArtist) {
    if (!rawArtist) return '';
    return rawArtist
      .split(/[,&/•]|(?:\s+feat\.?\s+)|(?:\s+ft\.?\s+)|(?:\s+and\s+)/i)[0]
      .replace(/\s*-\s*topic/i, '')
      .replace(/["“”'‘’]/g, '')
      .trim();
  }

  // 2. Binary Search for O(log n) Lyric Lookup
  function getActiveLyricIndex(currentTime) {
    if (!lyricsData.length) return -1;
    const offsetSec = (parseInt(prefs.timeOffsetMs, 10) || 0) / 1000;
    const target = currentTime + offsetSec;

    let low = 0;
    let high = lyricsData.length - 1;
    let match = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lyricsData[mid].time <= target) {
        match = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return match;
  }

  // 3. Palette Extraction with Caching & Error Safety
  function extractAlbumPalette(imgUrl) {
    if (!imgUrl || !prefs.syncAlbumArt) {
      activeTheme = { accent: prefs.accentColor, bgStart: prefs.bgStart, bgEnd: prefs.bgEnd };
      applyTheme();
      drawPiPFrame();
      return;
    }

    if (imgUrl === lastExtractedUrl) return;

    if (paletteCache.has(imgUrl)) {
      lastExtractedUrl = imgUrl;
      activeTheme = paletteCache.get(imgUrl);
      applyTheme();
      drawPiPFrame();
      return;
    }

    const requestedKey = currentKey; // Track track key for which extraction started
    GM_xmlhttpRequest({
      method: 'GET',
      url: imgUrl,
      responseType: 'blob',
      timeout: 5000,
      onload: (res) => {
        if (res.status !== 200 || !res.response) return;
        const blobUrl = URL.createObjectURL(res.response);
        const img = new Image();

        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          // Only drop if track changed to a completely different track while downloading
          if (currentKey && requestedKey && currentKey !== requestedKey) return;

          try {
            const sc = document.createElement('canvas');
            sc.width = 32;
            sc.height = 32;
            const sctx = sc.getContext('2d');
            sctx.drawImage(img, 0, 0, 32, 32);
            const data = sctx.getImageData(0, 0, 32, 32).data;

            let bestColor = null;
            let maxSat = -1;
            let totalR = 0, totalG = 0, totalB = 0, count = 0;

            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], b = data[i + 2];
              totalR += r; totalG += g; totalB += b; count++;

              const max = Math.max(r, g, b) / 255;
              const min = Math.min(r, g, b) / 255;
              const l = (max + min) / 2;
              const d = max - min;
              const s = d === 0 ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));

              if (s > maxSat && l >= 0.35 && l <= 0.85) {
                maxSat = s;
                bestColor = `rgb(${r}, ${g}, ${b})`;
              }
            }

            const avgR = Math.floor((totalR / count) * 0.14);
            const avgG = Math.floor((totalG / count) * 0.14);
            const avgB = Math.floor((totalB / count) * 0.14);

            const themeResult = {
              accent: bestColor || prefs.accentColor,
              bgStart: `rgb(${avgR}, ${avgG}, ${avgB})`,
              bgEnd: `rgb(${Math.floor(avgR * 1.8)}, ${Math.floor(avgG * 1.8)}, ${Math.floor(avgB * 2.2)})`
            };

            lastExtractedUrl = imgUrl;
            paletteCache.set(imgUrl, themeResult);
            activeTheme = themeResult;
            applyTheme();
            drawPiPFrame();
          } catch (e) {}
        };

        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
        };

        img.src = blobUrl;
      },
      onerror: () => {},
      ontimeout: () => {}
    });
  }

  function applyTheme() {
    const curAccent = prefs.syncAlbumArt ? activeTheme.accent : prefs.accentColor;
    const curBgStart = prefs.syncAlbumArt ? activeTheme.bgStart : prefs.bgStart;
    const curBgEnd = prefs.syncAlbumArt ? activeTheme.bgEnd : prefs.bgEnd;
    const fontCss = getCSSFont();
    const fontSize = parseInt(prefs.lyricsFontSize, 10) || 18;

    const root = document.documentElement;
    root.style.setProperty('--ytm-accent', curAccent);
    root.style.setProperty('--ytm-font', fontCss);
    root.style.setProperty('--ytm-lyrics-font-size', `${fontSize}px`);
    root.style.setProperty('--ytm-accent-glow', colorWithAlpha(curAccent, 0.45));
    root.style.setProperty('--ytm-bg-start', curBgStart);
    root.style.setProperty('--ytm-bg-end', curBgEnd);

    const backdrop = document.getElementById('ytm-ambient-backdrop');
    if (backdrop) {
      backdrop.style.background = `
        radial-gradient(circle at 18% 30%, ${colorWithAlpha(curAccent, 0.28)} 0%, transparent 60%),
        radial-gradient(circle at 82% 65%, ${colorWithAlpha(curBgEnd, 0.45)} 0%, transparent 65%),
        radial-gradient(circle at 50% 88%, ${colorWithAlpha(curAccent, 0.12)} 0%, transparent 60%),
        linear-gradient(150deg, ${curBgStart} 0%, #030307 100%)
      `;
    }

    // Neutralize native YouTube Music background variables so our dynamic ambient mesh shines through
    const playerPage = getPlayerPage();
    if (playerPage) {
      playerPage.style.setProperty('--ytmusic-player-page-background', 'transparent', 'important');
      playerPage.style.setProperty('--ytmusic-player-page-side-panel-background', 'transparent', 'important');
    }
  }

  // 4. Initializing Canvas Pipeline
  function initPiPCanvas() {
    if (canvas) return;

    canvas = document.createElement('canvas');
    canvas.id = 'ytm-pip-stream-canvas';
    canvas.width = 520;
    canvas.height = 520;
    ctx = canvas.getContext('2d');

    pipVideo = document.createElement('video');
    pipVideo.id = 'ytm-pip-stream-video';
    pipVideo.muted = true;
    pipVideo.playsInline = true;
    pipVideo.autoplay = true;

    pipVideo.style.cssText = `
      position: fixed; bottom: 0; left: 0; width: 520px; height: 520px;
      aspect-ratio: 1 / 1; opacity: 0.001; pointer-events: none; z-index: -1;
    `;
    document.body.appendChild(pipVideo);

    ctx.fillStyle = '#08070e';
    ctx.fillRect(0, 0, 520, 520);

    if (typeof canvas.captureStream === 'function') {
      const stream = canvas.captureStream(30);
      pipVideo.srcObject = stream;
    }

    let pauseDebounceTimer = null;

    function handlePipClose() {
      clearTimeout(pauseDebounceTimer);
      isPipActive = false;
      // If closing PiP caused Safari to momentarily pause the main track in the background, auto-resume it!
      if (Date.now() - lastPlayingTimestamp < 1500) {
        setTimeout(() => {
          const v = getYTMVideo();
          if (v && v.paused) {
            toggleYTMPlayback(true);
          }
        }, 120);
      }
    }

    pipVideo.addEventListener('enterpictureinpicture', () => {
      clearTimeout(pauseDebounceTimer);
      isPipActive = true;
      drawPiPFrame();
    });
    pipVideo.addEventListener('leavepictureinpicture', handlePipClose);
    pipVideo.addEventListener('webkitpresentationmodechanged', () => {
      const active = (pipVideo.webkitPresentationMode === 'picture-in-picture');
      if (active) {
        clearTimeout(pauseDebounceTimer);
        isPipActive = true;
        drawPiPFrame();
      } else if (isPipActive) {
        handlePipClose();
      }
    });

    // Native PiP Play/Pause Controls
    pipVideo.addEventListener('pause', () => {
      clearTimeout(pauseDebounceTimer);
      pauseDebounceTimer = setTimeout(() => {
        // Only pause YTM if PiP is STILL open (user intentionally clicked Pause button, not ✕ close)
        const isInPip = (pipVideo.webkitPresentationMode === 'picture-in-picture') || (document.pictureInPictureElement === pipVideo);
        if (isPipActive && isInPip) {
          const video = getYTMVideo();
          if (video && !video.paused) {
            lastPlayingTimestamp = 0;
            toggleYTMPlayback(false);
          }
        }
      }, 80);
    });

    // When the user resumes playback via the PiP overlay Play button, ensure YTM playback resumes
    pipVideo.addEventListener('play', () => {
      clearTimeout(pauseDebounceTimer);
      if (!isPipActive) return;
      const video = getYTMVideo();
      if (video && video.paused) {
        toggleYTMPlayback(true);
      }
      drawPiPFrame();
    });
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
    // Robust word-wrap supporting both spaced text and non-spaced CJK characters
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

    for (let n = 0; n < words.length; n++) {
      const word = words[n];
      const testLine = currentLine ? (currentLine + ' ' + word) : word;
      if (context.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        // If single word exceeds maxWidth, break by characters
        if (context.measureText(word).width > maxWidth) {
          let charChunk = '';
          for (let c = 0; c < word.length; c++) {
            const testChar = charChunk + word[c];
            if (context.measureText(testChar).width > maxWidth) {
              lines.push(charChunk);
              charChunk = word[c];
            } else {
              charChunk = testChar;
            }
          }
          currentLine = charChunk;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);

    // Safeguard: cap at max 3 lines to ensure zero vertical clipping with adjacent lyrics
    if (lines.length > 3) {
      lines = lines.slice(0, 3);
      lines[2] = lines[2].replace(/[.,;:!?\s]*$/, '…');
    }

    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => {
      context.fillText(l.trim(), x, startY + (i * lineHeight));
    });
  }

  function truncateWithEllipsis(context, text, maxW) {
    if (!text) return '';
    if (context.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 0 && context.measureText(t + '…').width > maxW) {
      t = t.slice(0, -1);
    }
    return t ? (t + '…') : '';
  }

  // 5. PiP Frame Engine
  function drawPiPFrame() {
    if (!ctx) return;
    const video = getYTMVideo();
    const currentTime = video ? video.currentTime : 0;
    const duration = video && isFinite(video.duration) && video.duration > 0 ? video.duration : (currentSong.duration || 1);
    const isPaused = video ? video.paused : false;

    const curAccent = prefs.syncAlbumArt ? activeTheme.accent : prefs.accentColor;
    const curBgStart = prefs.syncAlbumArt ? activeTheme.bgStart : prefs.bgStart;
    const curBgEnd = prefs.syncAlbumArt ? activeTheme.bgEnd : prefs.bgEnd;
    const curFontSize = parseInt(prefs.pipFontSize, 10) || 32;

    // Background Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 520, 520);
    bgGrad.addColorStop(0, curBgStart);
    bgGrad.addColorStop(1, curBgEnd);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 520, 520);

    // Dynamic Glow Accent
    const glow = ctx.createRadialGradient(260, 240, 20, 260, 240, 260);
    glow.addColorStop(0, colorWithAlpha(curAccent, 0.18));
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 520, 520);

    // Track Title Marquee
    const titleText = currentSong.title || 'Waiting for playback...';
    ctx.font = getCanvasFont('bold', 22);
    const titleWidth = ctx.measureText(titleText).width;
    const maxTitleWidth = 440;

    if (titleWidth <= maxTitleWidth) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(titleText, 260, 48);
    } else {
      const gap = 70;
      const loopDistance = titleWidth + gap;
      const scrollOffset = isPaused ? 0 : (Date.now() / 25) % loopDistance;

      ctx.save();
      ctx.beginPath();
      ctx.rect(40, 22, 440, 36);
      ctx.clip();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(titleText, 40 - scrollOffset, 48);
      ctx.fillText(titleText, 40 - scrollOffset + loopDistance, 48);
      ctx.restore();

      const leftFade = ctx.createLinearGradient(40, 0, 70, 0);
      leftFade.addColorStop(0, curBgStart);
      leftFade.addColorStop(1, colorWithAlpha(curBgStart, 0));
      ctx.fillStyle = leftFade;
      ctx.fillRect(40, 22, 30, 36);

      const rightFade = ctx.createLinearGradient(450, 0, 480, 0);
      rightFade.addColorStop(0, colorWithAlpha(curBgStart, 0));
      rightFade.addColorStop(1, curBgStart);
      ctx.fillStyle = rightFade;
      ctx.fillRect(450, 22, 30, 36);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = curAccent;
    ctx.font = getCanvasFont('700', 13);
    const displayArtist = (currentSong.artist || 'YouTube Music').slice(0, 45);
    ctx.fillText(displayArtist.toUpperCase(), 260, 74);

    // Lyric Render States
    if (lyricState === 'searching') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = getCanvasFont('500', 16);
      ctx.fillText('Syncing lyrics...', 260, 245);
    } else if (lyricState === 'rate_limited') {
      const remainingSec = Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      ctx.fillStyle = curAccent;
      ctx.font = getCanvasFont('bold', 28);
      ctx.fillText('⏳', 260, 215);

      ctx.fillStyle = '#ffffff';
      ctx.font = getCanvasFont('bold', 17);
      ctx.fillText('Lyrics Service Cooldown', 260, 252);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = getCanvasFont('normal', 13);
      ctx.fillText(`Retrying in ${remainingSec}s...`, 260, 278);
    } else if (lyricState === 'plain') {
      ctx.fillStyle = curAccent;
      ctx.font = getCanvasFont('bold', 14);
      ctx.fillText('STATIC LYRICS (UNSYNCED)', 260, 180);

      ctx.fillStyle = '#ffffff';
      ctx.font = getCanvasFont('500', 16);
      ctx.fillText('Available in YTM window', 260, 248);
    } else if (lyricState === 'empty' || !lyricsData.length) {
      ctx.fillStyle = curAccent;
      ctx.font = getCanvasFont('bold', 36);
      ctx.fillText('♫', 260, 215);

      ctx.fillStyle = '#ffffff';
      ctx.font = getCanvasFont('bold', 18);
      ctx.fillText('Instrumental or No Lyrics', 260, 254);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = getCanvasFont('normal', 13);
      ctx.fillText('Enjoy the track', 260, 280);
    } else {
      const activeIdx = getActiveLyricIndex(currentTime);

      if (activeIdx === -1) {
        // Track Intro: Before first lyric with clean solid accent glow
        ctx.save();
        ctx.fillStyle = curAccent;
        ctx.font = getCanvasFont('bold', 22);
        ctx.shadowColor = colorWithAlpha(curAccent, 0.9);
        ctx.shadowBlur = 20;
        ctx.fillText('♪  Intro  ♪', 260, 235);
        ctx.restore();

        if (lyricsData[0]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = getCanvasFont('500', Math.max(15, curFontSize - 12));
          const previewText = truncateWithEllipsis(ctx, lyricsData[0].text, 440);
          ctx.fillText(previewText, 260, 285);
        }

        if (lyricsData[1]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.font = getCanvasFont('normal', Math.max(13, curFontSize - 16));
          const previewText2 = truncateWithEllipsis(ctx, lyricsData[1].text, 440);
          ctx.fillText(previewText2, 260, 335);
        }
      } else {
        // Line -2 (Far previous lyric)
        if (activeIdx - 2 >= 0 && lyricsData[activeIdx - 2]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.font = getCanvasFont('normal', Math.max(13, curFontSize - 16));
          const prevText2 = truncateWithEllipsis(ctx, lyricsData[activeIdx - 2].text, 440);
          ctx.fillText(prevText2, 260, 135);
        }

        // Line -1 (Immediate previous lyric)
        if (activeIdx - 1 >= 0 && lyricsData[activeIdx - 1]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = getCanvasFont('500', Math.max(15, curFontSize - 12));
          const prevText = truncateWithEllipsis(ctx, lyricsData[activeIdx - 1].text, 440);
          ctx.fillText(prevText, 260, 195);
        }

        // Line 0 (Active lyric) - Centered at y = 265
        if (lyricsData[activeIdx]) {
          ctx.fillStyle = '#ffffff';
          ctx.font = getCanvasFont('bold', curFontSize);
          ctx.shadowColor = colorWithAlpha(curAccent, 0.95);
          ctx.shadowBlur = 24;
          drawWrappedText(ctx, lyricsData[activeIdx].text, 260, 265, 460, curFontSize + 6);
          ctx.shadowBlur = 0;
        }

        // Line +1 (Immediate upcoming lyric)
        if (activeIdx + 1 < lyricsData.length && lyricsData[activeIdx + 1]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = getCanvasFont('500', Math.max(15, curFontSize - 12));
          const nextText = truncateWithEllipsis(ctx, lyricsData[activeIdx + 1].text, 440);
          ctx.fillText(nextText, 260, 335);
        }

        // Line +2 (Far upcoming lyric)
        if (activeIdx + 2 < lyricsData.length && lyricsData[activeIdx + 2]) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.font = getCanvasFont('normal', Math.max(13, curFontSize - 16));
          const nextText2 = truncateWithEllipsis(ctx, lyricsData[activeIdx + 2].text, 440);
          ctx.fillText(nextText2, 260, 395);
        }
      }
    }

    // Bottom Progress Bar & Timestamps
    const barX = 42;
    const barY = 456;
    const barW = 436;
    const barH = 4;
    const progress = Math.min(Math.max(currentTime / duration, 0), 1);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 2);
      ctx.fill();
    } else {
      ctx.fillRect(barX, barY, barW, barH);
    }

    ctx.fillStyle = curAccent;
    if (progress > 0) {
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(barX, barY, Math.max(4, barW * progress), barH, 2);
        ctx.fill();
      } else {
        ctx.fillRect(barX, barY, barW * progress, barH);
      }
    }

    ctx.font = getCanvasFont('normal', 12);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(currentTime), barX, barY + 22);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(duration), barX + barW, barY + 22);
  }

  // 6. Battery-Optimized Dual-Engine Render Loop
  let lastDrawTime = 0;
  function startRenderLoop() {
    function render(now) {
      // Only render continuous canvas frames when Picture-in-Picture is actively open
      if (isPipActive) {
        // Cap to 30fps matching canvas.captureStream(30) to eliminate wasted ProMotion 120Hz frames
        if (!lastDrawTime || now - lastDrawTime >= 33) {
          lastDrawTime = now;
          drawPiPFrame();
        }
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    // Fallback interval for backgrounded Safari PWA with active PiP
    setInterval(() => {
      if (isPipActive && document.hidden) {
        drawPiPFrame();
      }
    }, 75);
  }

  function triggerPiP() {
    if (!pipVideo) initPiPCanvas();
    drawPiPFrame();
    pipVideo.play().catch(() => {});

    if (document.pictureInPictureElement || (pipVideo.webkitPresentationMode && pipVideo.webkitPresentationMode === 'picture-in-picture')) {
      if (document.exitPictureInPicture) {
        document.exitPictureInPicture().catch(() => {});
      } else if (pipVideo.webkitSetPresentationMode) {
        pipVideo.webkitSetPresentationMode('inline');
      }
      isPipActive = false;
      return;
    }

    isPipActive = true;
    if (typeof pipVideo.requestPictureInPicture === 'function') {
      pipVideo.requestPictureInPicture().catch(() => {
        if (typeof pipVideo.webkitSetPresentationMode === 'function') {
          pipVideo.webkitSetPresentationMode('picture-in-picture');
        }
      });
    } else if (typeof pipVideo.webkitSetPresentationMode === 'function') {
      pipVideo.webkitSetPresentationMode('picture-in-picture');
    }
  }

  // 7. Player Screen Glass Effect & Integrated Lyrics Tab UI
  let tabsObserver = null;

  function openPrefsModal() {
    const modal = document.getElementById('ytm-prefs-modal');
    if (modal) modal.classList.add('active');
  }

  function closePrefsModal() {
    const modal = document.getElementById('ytm-prefs-modal');
    if (modal) modal.classList.remove('active');
  }

  function getPlayerPage() {
    return document.querySelector('ytmusic-player-page#player-page') || document.querySelector('ytmusic-player-page');
  }

  function scrollLyricsToElement(rowElement, smooth = true) {
    if (!rowElement) return;
    const container = document.getElementById('ytm-lyrics-scroll-container');
    if (!container) return;

    const rowRect = rowElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // The distance of the row relative to the visible container top
    const relativeTop = rowRect.top - containerRect.top;
    const targetScrollTop = container.scrollTop + relativeTop - (container.clientHeight / 2) + (rowRect.height / 2);

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function getLyricsTabButton() {
    const playerPage = getPlayerPage();
    if (!playerPage) return null;
    const tabs = Array.from(playerPage.querySelectorAll('tp-yt-paper-tab, paper-tab, ytmusic-tab-header-renderer, .tab-header'));
    return tabs.find(t => (t.textContent || '').trim().toUpperCase().includes('LYRIC')) || null;
  }

  function detectActiveTabName() {
    const playerPage = getPlayerPage();
    if (!playerPage) return 'UP NEXT';
    const tabs = Array.from(playerPage.querySelectorAll('tp-yt-paper-tab, paper-tab, ytmusic-tab-header-renderer'));
    const activeTab = tabs.find(t => t.classList.contains('iron-selected') || t.getAttribute('aria-selected') === 'true');
    if (!activeTab) return 'UP NEXT';
    const txt = activeTab.textContent.trim().toUpperCase();
    if (txt.includes('LYRIC')) return 'LYRICS';
    if (txt.includes('UP NEXT') || txt.includes('QUEUE')) return 'UP NEXT';
    if (txt.includes('COMMENT')) return 'COMMENTS';
    if (txt.includes('RELATED')) return 'RELATED';
    return txt;
  }

  function updateTabVisibility(forcedTab) {
    const playerPage = getPlayerPage();
    if (!playerPage) return;

    const currentTab = forcedTab || detectActiveTabName();
    const previousTab = playerPage.getAttribute('data-ytm-active-tab');
    if (previousTab !== currentTab) {
      playerPage.setAttribute('data-ytm-active-tab', currentTab);
    }

    const lyricsContainer = document.getElementById('ytm-tab-lyrics-container');
    if (!lyricsContainer) return;

    if (currentTab === 'LYRICS') {
      lyricsContainer.style.setProperty('display', 'flex', 'important');
      if (previousTab !== 'LYRICS' && lastActiveIdx >= 0 && cachedDomRows[lastActiveIdx] && !isUserScrolling) {
        scrollLyricsToElement(cachedDomRows[lastActiveIdx], false);
      }
    } else {
      lyricsContainer.style.setProperty('display', 'none', 'important');
    }
  }

  function setupTabsWatcher() {
    const playerPage = getPlayerPage();
    if (!playerPage) return;

    const tabsContainer = playerPage.querySelector('tp-yt-paper-tabs, paper-tabs, ytmusic-tabs');
    if (!tabsContainer) return;

    const allTabs = Array.from(playerPage.querySelectorAll('tp-yt-paper-tab, paper-tab, ytmusic-tab-header-renderer'));
    const lyricsTab = getLyricsTabButton();

    if (lyricsTab) {
      // Un-disable Lyrics tab if YouTube Music natively disabled it
      if (lyricsTab.hasAttribute('disabled')) lyricsTab.removeAttribute('disabled');
      if (lyricsTab.getAttribute('aria-disabled') === 'true') lyricsTab.setAttribute('aria-disabled', 'false');
      lyricsTab.style.pointerEvents = 'auto';
      lyricsTab.style.cursor = 'pointer';
      lyricsTab.style.opacity = '1';

      if (!lyricsTab.__ytmGlassBound) {
        lyricsTab.__ytmGlassBound = true;
        lyricsTab.addEventListener('click', () => {
          allTabs.forEach(t => {
            if (t !== lyricsTab) {
              t.classList.remove('iron-selected');
              t.setAttribute('aria-selected', 'false');
            }
          });
          lyricsTab.classList.add('iron-selected');
          lyricsTab.setAttribute('aria-selected', 'true');
          updateTabVisibility('LYRICS');
        });
      }
    }

    allTabs.forEach(tab => {
      if (tab !== lyricsTab && !tab.__ytmGlassBound) {
        tab.__ytmGlassBound = true;
        tab.addEventListener('click', () => {
          if (lyricsTab) {
            lyricsTab.classList.remove('iron-selected');
            lyricsTab.setAttribute('aria-selected', 'false');
          }
          setTimeout(() => updateTabVisibility(), 60);
        });
      }
    });

    if (!tabsObserver && tabsContainer) {
      tabsObserver = new MutationObserver(() => {
        updateTabVisibility();
      });
      tabsObserver.observe(tabsContainer, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-selected', 'selected'] });
    }
  }



  function injectPlayerGlassUI() {
    if (document.getElementById('ytm-glass-styles')) return;

    const style = document.createElement('style');
    style.id = 'ytm-glass-styles';
    style.textContent = `
      :root {
        --ytm-accent: ${prefs.accentColor};
        --ytm-font: ${getCSSFont()};
        --ytm-lyrics-font-size: ${prefs.lyricsFontSize}px;
        --ytm-accent-glow: ${colorWithAlpha(prefs.accentColor, 0.45)};
        --ytm-bg-start: ${prefs.bgStart};
        --ytm-bg-end: ${prefs.bgEnd};
      }

      /* Global scrollbar protections to eliminate right-side gutter */
      html, body, ytmusic-app {
        scrollbar-width: none !important;
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      ytmusic-app::-webkit-scrollbar {
        display: none !important;
        width: 0px !important;
        height: 0px !important;
      }

      /* Player Screen Dynamic Ambient Mesh Backdrop (Integrated Inside Player Page) */
      #ytm-ambient-backdrop {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
        background-repeat: no-repeat !important;
        background-size: cover !important;
        background:
          radial-gradient(circle at 18% 30%, ${colorWithAlpha(prefs.accentColor, 0.28)} 0%, transparent 60%),
          radial-gradient(circle at 82% 65%, ${colorWithAlpha(prefs.bgEnd, 0.45)} 0%, transparent 65%),
          radial-gradient(circle at 50% 88%, ${colorWithAlpha(prefs.accentColor, 0.12)} 0%, transparent 60%),
          linear-gradient(150deg, ${prefs.bgStart} 0%, #030307 100%);
        transition: background 1.2s cubic-bezier(0.2, 0, 0, 1);
        will-change: background;
      }

      /* Home Screen Top Nav Bar Glass (Edge-to-Edge with Zero Right-Side Gap) */
      ytmusic-nav-bar {
        width: 100vw !important;
        max-width: 100vw !important;
        box-sizing: border-box !important;
        background: rgba(10, 8, 16, 0.65) !important;
        backdrop-filter: blur(24px) saturate(200%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(200%) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
      }

      /* Category Glass Chips on Home Screen (Sleek Compact Rounded Pills) */
      ytmusic-chip-cloud-chip-renderer {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        --ytmusic-chip-background-color: rgba(255, 255, 255, 0.08) !important;
        --yt-spec-badge-chip-background: rgba(255, 255, 255, 0.08) !important;
      }
      ytmusic-chip-cloud-chip-renderer a,
      ytmusic-chip-cloud-chip-renderer button,
      ytmusic-chip-cloud-chip-renderer [role="button"],
      ytmusic-chip-cloud-chip-renderer #chip,
      ytmusic-chip-cloud-chip-renderer .chip-container {
        border-radius: 999px !important;
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        transition: all 0.2s ease !important;
      }
      ytmusic-chip-cloud-chip-renderer:hover a,
      ytmusic-chip-cloud-chip-renderer:hover button,
      ytmusic-chip-cloud-chip-renderer:hover [role="button"],
      ytmusic-chip-cloud-chip-renderer:hover #chip {
        background: rgba(255, 255, 255, 0.16) !important;
        border-color: rgba(255, 255, 255, 0.24) !important;
      }
      ytmusic-chip-cloud-chip-renderer[selected] a,
      ytmusic-chip-cloud-chip-renderer[selected] button,
      ytmusic-chip-cloud-chip-renderer[selected] [role="button"],
      ytmusic-chip-cloud-chip-renderer[selected] #chip,
      ytmusic-chip-cloud-chip-renderer[is-selected] a,
      ytmusic-chip-cloud-chip-renderer[is-selected] button {
        background: var(--ytm-accent) !important;
        border-color: var(--ytm-accent) !important;
        box-shadow: 0 0 14px var(--ytm-accent-glow) !important;
        color: #ffffff !important;
      }

      /* Left Guide Navigation Bar Glass */
      ytmusic-guide-renderer,
      #guide-content.ytmusic-guide-renderer {
        background: rgba(8, 6, 12, 0.55) !important;
        backdrop-filter: blur(28px) saturate(200%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(200%) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
      }
      ytmusic-guide-entry-renderer:hover {
        background: rgba(255, 255, 255, 0.08) !important;
        border-radius: 10px !important;
      }
      ytmusic-guide-entry-renderer[is-primary] yt-icon,
      ytmusic-guide-entry-renderer[active] yt-icon {
        color: var(--ytm-accent) !important;
      }

      /* Album Cards Sleek Rounded Corners */
      ytmusic-two-row-item-renderer .image-wrapper,
      ytmusic-two-row-item-renderer .image-wrapper img,
      ytmusic-two-row-item-renderer .image-wrapper yt-img-shadow,
      ytmusic-custom-index-column-item-renderer .image-wrapper,
      ytmusic-custom-index-column-item-renderer .image-wrapper img,
      ytmusic-custom-index-column-item-renderer .image-wrapper yt-img-shadow {
        border-radius: 14px !important;
      }

      /* 1. Player Page Base (ZERO Layout Overrides & Stale Native Background Elimination) */
      ytmusic-player-page#player-page,
      ytmusic-player-page {
        background: transparent !important;
        --ytmusic-player-page-background: transparent !important;
        --ytmusic-player-page-side-panel-background: transparent !important;
        font-family: var(--ytm-font) !important;
      }

      /* Completely neutralize native YTM background layers & canvases so only our dynamic ambient mesh shines through */
      ytmusic-player-page #background,
      ytmusic-player-page .background,
      #background.ytmusic-player-page,
      ytmusic-player-page ytmusic-background-overlay-renderer,
      ytmusic-player-page #backdrop,
      ytmusic-player-page canvas:not(#ytm-pip-stream-canvas) {
        background: transparent !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* 2. Album Artwork Glow (Left Panel: Native Size & Placement) */
      ytmusic-player-page #main-panel {
        position: relative !important;
        z-index: 1 !important;
        background: transparent !important;
      }
      ytmusic-player-page #player {
        background: transparent !important;
      }
      ytmusic-player-page #player,
      ytmusic-player-page #song-image,
      ytmusic-player-page .thumbnail-image-wrapper {
        border-radius: 20px !important;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.75), 0 0 90px var(--ytm-accent-glow) !important;
        transition: box-shadow 1.2s ease !important;
      }
      ytmusic-player-page #song-image img,
      ytmusic-player-page #player video {
        border-radius: 20px !important;
      }

      /* 3. Frosted Glass Side Panel (Right Panel: Perfectly Aligned with Art & Dynamic Theme) */
      ytmusic-player-page #side-panel {
        position: relative !important;
        z-index: 2 !important;
        background: color-mix(in srgb, var(--ytm-bg-start, #0c0a14) 22%, rgba(12, 10, 20, 0.60)) !important;
        backdrop-filter: blur(40px) saturate(210%) !important;
        -webkit-backdrop-filter: blur(40px) saturate(210%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 24px !important;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.65), 0 0 45px var(--ytm-accent-glow), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
        margin: 0 !important;
        margin-left: clamp(20px, 2.5vw, 40px) !important;
        padding: 12px 14px 14px 14px !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        box-sizing: border-box !important;
        min-height: 0 !important;
        transition: box-shadow 1.2s ease, background 1.2s ease !important;
      }

      /* 4. Tab Navigation Bar (Full 48px Height, Never Squished) */
      ytmusic-player-page tp-yt-paper-tabs,
      ytmusic-player-page paper-tabs,
      ytmusic-player-page ytmusic-tabs {
        background: transparent !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        --paper-tabs-selection-bar-color: var(--ytm-accent) !important;
        flex: 0 0 48px !important;
        height: 48px !important;
        min-height: 48px !important;
        margin-bottom: 6px !important;
        overflow: visible !important;
        box-sizing: border-box !important;
      }
      ytmusic-player-page tp-yt-paper-tab,
      ytmusic-player-page paper-tab {
        color: rgba(255, 255, 255, 0.6) !important;
        font-family: var(--ytm-font) !important;
        font-weight: 600 !important;
        letter-spacing: 0.5px !important;
        font-size: 13px !important;
        transition: color 0.2s ease !important;
        height: 48px !important;
        line-height: 48px !important;
        padding: 0 14px !important;
        box-sizing: border-box !important;
      }
      ytmusic-player-page tp-yt-paper-tab:hover,
      ytmusic-player-page paper-tab:hover {
        color: #ffffff !important;
      }
      ytmusic-player-page tp-yt-paper-tab.iron-selected,
      ytmusic-player-page paper-tab.iron-selected {
        color: #ffffff !important;
        font-weight: 700 !important;
      }
      ytmusic-player-page #selectionBar.tp-yt-paper-tabs {
        background-color: var(--ytm-accent) !important;
        border-bottom: 2px solid var(--ytm-accent) !important;
        box-shadow: 0 0 12px var(--ytm-accent) !important;
      }

      /* Tab Content / Queue Container Flexibility & Full Transparency */
      ytmusic-player-page #side-panel #tab-renderer,
      ytmusic-player-page #side-panel ytmusic-tab-renderer,
      ytmusic-player-page #side-panel ytmusic-player-queue,
      ytmusic-player-page #side-panel #queue,
      ytmusic-player-page #side-panel ytmusic-section-list-renderer,
      ytmusic-player-page #side-panel ytmusic-description-shelf-renderer,
      ytmusic-player-page #side-panel ytmusic-message-renderer,
      ytmusic-player-page #side-panel .tab-header-container,
      ytmusic-player-page #side-panel .tab-content,
      ytmusic-player-page #side-panel #contents,
      ytmusic-player-page #side-panel #items {
        background: transparent !important;
      }
      ytmusic-player-page #tab-renderer,
      ytmusic-player-page ytmusic-tab-renderer {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow-y: auto !important;
      }

      /* 5. Hide Native Lyrics when LYRICS Tab is Active */
      ytmusic-player-page[data-ytm-active-tab="LYRICS"] ytmusic-description-shelf-renderer,
      ytmusic-player-page[data-ytm-active-tab="LYRICS"] ytmusic-message-renderer,
      ytmusic-player-page[data-ytm-active-tab="LYRICS"] #tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"],
      ytmusic-player-page[data-ytm-active-tab="LYRICS"] ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] {
        display: none !important;
      }

      /* 6. Integrated Synced Lyrics Container inside Side Panel */
      #ytm-tab-lyrics-container {
        display: none;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        position: relative;
        overflow: hidden;
        font-family: var(--ytm-font);
        padding-top: 6px;
      }

      #ytm-tab-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px 12px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        user-select: none;
      }
      #ytm-track-meta {
        overflow: hidden;
        flex: 1;
        min-width: 0;
        padding-right: 12px;
      }
      #ytm-ui-title-container {
        overflow: hidden;
        white-space: nowrap;
      }
      #ytm-ui-title {
        display: inline-block;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
      }
      #ytm-ui-title.is-marquee {
        animation: ytmMarquee 8s ease-in-out infinite alternate;
      }
      @keyframes ytmMarquee {
        0%, 20% { transform: translateX(0); }
        80%, 100% { transform: translateX(calc(-100% + 150px)); }
      }
      #ytm-ui-artist {
        font-size: 11px;
        font-weight: 600;
        color: var(--ytm-accent);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
      }

      #ytm-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #ytm-actions button {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #eee;
        padding: 6px 12px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      #ytm-actions button:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
        border-color: rgba(255, 255, 255, 0.24);
      }
      #ytm-actions button#ytm-pip-btn:hover {
        background: var(--ytm-accent);
        border-color: var(--ytm-accent);
        color: #fff;
        box-shadow: 0 0 14px var(--ytm-accent);
      }

      /* 7. Synced Lyrics Scrolling View (Identical to Original Perfect Look) */
      #ytm-lyrics-scroll-container {
        flex: 1;
        overflow-y: auto;
        padding: 18px 16px;
        scroll-behavior: smooth;
        mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
        scrollbar-width: none !important;
      }
      ytmusic-player-page #side-panel::-webkit-scrollbar,
      ytmusic-player-page #side-panel *::-webkit-scrollbar {
        display: none !important;
        width: 0px !important;
        height: 0px !important;
      }
      ytmusic-player-page #side-panel,
      ytmusic-player-page #side-panel * {
        scrollbar-width: none !important;
      }
      #ytm-lyrics-list {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px 0;
      }
      .ytm-lrc-row {
        opacity: 0.35;
        font-size: var(--ytm-lyrics-font-size);
        line-height: 1.45;
        cursor: pointer;
        transition: all 0.2s ease;
        border-radius: 8px;
        padding: 4px 6px;
        color: #fff;
      }
      .ytm-lrc-row:hover {
        opacity: 0.85;
        background: rgba(255, 255, 255, 0.08);
      }
      .ytm-lrc-row.active {
        opacity: 1;
        font-weight: 700;
        font-size: calc(var(--ytm-lyrics-font-size) + 2px);
        color: var(--ytm-accent);
        transform: scale(1.02);
        transform-origin: left center;
        text-shadow: 0 0 16px var(--ytm-accent);
      }
      .ytm-plain-lyrics-view {
        white-space: pre-wrap;
        font-size: var(--ytm-lyrics-font-size);
        line-height: 1.6;
        opacity: 0.85;
        padding: 10px 4px;
      }

      /* 8. Queue Items Glass Styling (When UP NEXT is Active) */
      ytmusic-player-queue-item {
        border-radius: 10px !important;
        transition: background 0.15s ease !important;
        margin: 1px 0 !important;
      }
      ytmusic-player-queue-item:hover {
        background: rgba(255, 255, 255, 0.08) !important;
      }
      ytmusic-player-queue-item[selected] {
        background: rgba(255, 255, 255, 0.12) !important;
        border-left: 3px solid var(--ytm-accent) !important;
      }

      /* 9. Player Bar Glass Polish & Edge-to-Edge Guarantee */
      ytmusic-player-bar {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100vw !important;
        min-width: 100vw !important;
        max-width: 100vw !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        background: rgba(10, 8, 16, 0.75) !important;
        backdrop-filter: blur(28px) saturate(200%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(200%) !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
        z-index: 1000 !important;
      }
      #progress-bar.ytmusic-player-bar {
        --paper-slider-active-color: var(--ytm-accent) !important;
      }
      #progress-bar.ytmusic-player-bar[focused],
      ytmusic-player-bar:hover #progress-bar.ytmusic-player-bar {
        --paper-slider-knob-color: var(--ytm-accent) !important;
        --paper-slider-knob-start-color: var(--ytm-accent) !important;
        --paper-slider-knob-start-border-color: var(--ytm-accent) !important;
      }

      /* 10. Jump to Current Lyric Floating Pill */
      #ytm-jump-active-btn {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: var(--ytm-accent);
        color: #fff;
        border: none;
        border-radius: 20px;
        padding: 7px 16px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 14px var(--ytm-accent);
        opacity: 0;
        pointer-events: none;
        transition: all 0.25s ease;
        z-index: 10;
      }
      #ytm-jump-active-btn.visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(-50%) translateY(0);
      }

      /* 11. Empty & Error States */
      .ytm-empty-state {
        text-align: center;
        padding: 50px 10px;
        user-select: none;
      }
      .ytm-empty-icon {
        font-size: 34px;
        color: var(--ytm-accent);
        margin-bottom: 8px;
        opacity: 0.85;
      }
      .ytm-empty-title {
        font-size: 15px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 4px;
      }
      .ytm-empty-sub {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.45);
        line-height: 1.4;
        margin-bottom: 12px;
      }
      .ytm-retry-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fff;
        padding: 6px 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .ytm-retry-btn:hover {
        background: var(--ytm-accent);
        border-color: var(--ytm-accent);
      }

      /* 12. Centered Appearance & Settings Modal */
      #ytm-prefs-modal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
        z-index: 1000000;
        font-family: var(--ytm-font);
      }
      #ytm-prefs-modal.active {
        display: flex;
      }
      .ytm-prefs-box {
        background: rgba(18, 16, 26, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 22px;
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.06);
        width: min(420px, 92vw);
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #fff;
        animation: ytmModalFadeIn 0.2s ease-out;
      }
      @keyframes ytmModalFadeIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .ytm-prefs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 14px;
        font-weight: 700;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      #ytm-prefs-close {
        background: none;
        border: none;
        color: #aaa;
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        line-height: 1;
      }
      #ytm-prefs-close:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }
      .ytm-prefs-content {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 20px;
        overflow-y: auto;
        font-size: 13px;
      }
      .ytm-pref-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-weight: 600;
      }
      .ytm-pref-toggle input[type="checkbox"] {
        accent-color: var(--ytm-accent);
        cursor: pointer;
        width: 16px;
        height: 16px;
      }
      .ytm-pref-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .ytm-pref-row select {
        background: #24222d;
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 5px 10px;
        font-size: 12px;
        font-family: inherit;
      }
      .ytm-pref-row input[type="color"] {
        border: none;
        width: 32px;
        height: 30px;
        border-radius: 6px;
        background: none;
        cursor: pointer;
      }
      .ytm-pref-col {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ytm-pref-slider-meta {
        display: flex;
        justify-content: space-between;
        opacity: 0.85;
        font-size: 12px;
      }
      .ytm-pref-col input[type="range"] {
        accent-color: var(--ytm-accent);
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);

    // Centered Settings Modal attached to body
    const modal = document.createElement('div');
    modal.id = 'ytm-prefs-modal';
    modal.innerHTML = `
      <div class="ytm-prefs-box">
        <div class="ytm-prefs-header">
          <span>Appearance & Engine Settings</span>
          <button id="ytm-prefs-close" type="button">✕</button>
        </div>
        <div class="ytm-prefs-content">
          <label class="ytm-pref-toggle">
            <input type="checkbox" id="pref-sync-album" ${prefs.syncAlbumArt ? 'checked' : ''}>
            <span>Auto-Sync Colors with Album Art</span>
          </label>

          <div class="ytm-pref-row" id="pref-accent-row" style="${prefs.syncAlbumArt ? 'opacity:0.4;pointer-events:none;' : ''}">
            <span>Custom Accent Color</span>
            <input type="color" id="pref-accent-color" value="${prefs.accentColor}">
          </div>

          <div class="ytm-pref-row">
            <span>Font Style</span>
            <select id="pref-font-family">
              <option value="system" ${prefs.fontFamily === 'system' ? 'selected' : ''}>System (SF Pro)</option>
              <option value="rounded" ${prefs.fontFamily === 'rounded' ? 'selected' : ''}>Rounded</option>
              <option value="mono" ${prefs.fontFamily === 'mono' ? 'selected' : ''}>Monospace</option>
              <option value="serif" ${prefs.fontFamily === 'serif' ? 'selected' : ''}>Serif Editorial</option>
            </select>
          </div>

          <div class="ytm-pref-col">
            <div class="ytm-pref-slider-meta">
              <span>PiP Active Lyric Size</span>
              <span id="pref-pip-size-label">${prefs.pipFontSize}px</span>
            </div>
            <input type="range" id="pref-pip-size" min="24" max="44" step="2" value="${prefs.pipFontSize}">
          </div>

          <div class="ytm-pref-col">
            <div class="ytm-pref-slider-meta">
              <span>Lyrics Font Size</span>
              <span id="pref-lyrics-size-label">${prefs.lyricsFontSize}px</span>
            </div>
            <input type="range" id="pref-lyrics-size" min="14" max="26" step="1" value="${prefs.lyricsFontSize}">
          </div>

          <div class="ytm-pref-col">
            <div class="ytm-pref-slider-meta">
              <span>Timing Calibration (Offset)</span>
              <span id="pref-offset-label">${(prefs.timeOffsetMs / 1000).toFixed(1)}s</span>
            </div>
            <input type="range" id="pref-offset-slider" min="-2000" max="2000" step="100" value="${prefs.timeOffsetMs}">
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#ytm-prefs-close')?.addEventListener('click', closePrefsModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePrefsModal();
    });

    const syncCb = modal.querySelector('#pref-sync-album');
    const accentRow = modal.querySelector('#pref-accent-row');
    if (syncCb && accentRow) {
      syncCb.addEventListener('change', () => {
        prefs.syncAlbumArt = syncCb.checked;
        accentRow.style.opacity = prefs.syncAlbumArt ? '0.4' : '1';
        accentRow.style.pointerEvents = prefs.syncAlbumArt ? 'none' : 'auto';
        extractAlbumPalette(currentSong.artwork);
        savePrefs();
      });
    }

    modal.querySelector('#pref-accent-color')?.addEventListener('input', (e) => {
      prefs.accentColor = e.target.value;
      savePrefs();
    });

    const fontSelect = modal.querySelector('#pref-font-family');
    if (fontSelect) {
      fontSelect.value = prefs.fontFamily;
      fontSelect.addEventListener('change', (e) => {
        prefs.fontFamily = e.target.value;
        savePrefs();
      });
    }

    const pipSlider = modal.querySelector('#pref-pip-size');
    const pipLabel = modal.querySelector('#pref-pip-size-label');
    if (pipSlider) {
      pipSlider.addEventListener('input', (e) => {
        prefs.pipFontSize = e.target.value;
        if (pipLabel) pipLabel.textContent = `${prefs.pipFontSize}px`;
        savePrefs();
      });
    }

    const lyricsSlider = modal.querySelector('#pref-lyrics-size');
    const lyricsLabel = modal.querySelector('#pref-lyrics-size-label');
    if (lyricsSlider) {
      lyricsSlider.addEventListener('input', (e) => {
        prefs.lyricsFontSize = e.target.value;
        if (lyricsLabel) lyricsLabel.textContent = `${prefs.lyricsFontSize}px`;
        savePrefs();
      });
    }

    const offsetSlider = modal.querySelector('#pref-offset-slider');
    const offsetLabel = modal.querySelector('#pref-offset-label');
    if (offsetSlider) {
      offsetSlider.addEventListener('input', (e) => {
        prefs.timeOffsetMs = parseInt(e.target.value, 10);
        if (offsetLabel) offsetLabel.textContent = `${(prefs.timeOffsetMs / 1000).toFixed(1)}s`;
        savePrefs();
      });
    }

    // Global keyboard shortcuts: Option+P for PiP, Escape for Modal, Option+Arrow for 10s Seek
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'Escape') {
        const m = document.getElementById('ytm-prefs-modal');
        if (m && m.classList.contains('active')) {
          closePrefsModal();
        }
      }
      if (e.altKey && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        triggerPiP();
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        const v = getYTMVideo();
        const p = getYTMPlayer();
        const target = (v ? v.currentTime : 0) + 10;
        if (p && typeof p.seekTo === 'function') p.seekTo(target, true);
        else if (v) v.currentTime = target;
        drawPiPFrame();
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        const v = getYTMVideo();
        const p = getYTMPlayer();
        const target = Math.max(0, (v ? v.currentTime : 0) - 10);
        if (p && typeof p.seekTo === 'function') p.seekTo(target, true);
        else if (v) v.currentTime = target;
        drawPiPFrame();
      }
    });

    applyTheme();
    ensurePlayerGlassInjected();
  }

  function ensureAmbientBackdrop() {
    const playerPage = getPlayerPage();
    if (!playerPage) return;

    let backdrop = document.getElementById('ytm-ambient-backdrop');
    if (backdrop && backdrop.parentNode !== playerPage) {
      backdrop.remove();
      backdrop = null;
    }
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'ytm-ambient-backdrop';
      playerPage.insertBefore(backdrop, playerPage.firstChild);
      applyTheme();
    }
  }

  function ensurePlayerGlassInjected() {
    ensureAmbientBackdrop();

    const playerPage = getPlayerPage();
    if (!playerPage) return;

    // 2. Lyrics Container in Side Panel
    const sidePanel = playerPage.querySelector('#side-panel');
    if (sidePanel && !document.getElementById('ytm-tab-lyrics-container')) {
      const lyricsContainer = document.createElement('div');
      lyricsContainer.id = 'ytm-tab-lyrics-container';
      lyricsContainer.innerHTML = `
        <div id="ytm-tab-header">
          <div id="ytm-track-meta">
            <div id="ytm-ui-title-container">
              <span id="ytm-ui-title">${currentSong.title || 'Waiting for playback...'}</span>
            </div>
            <div id="ytm-ui-artist">${currentSong.artist || 'YouTube Music'}</div>
          </div>
          <div id="ytm-actions">
            <button id="ytm-pip-btn" type="button" title="Pop out over other apps (macOS PiP)">⤢ Pop Out</button>
            <button id="ytm-gear-btn" type="button" title="Settings">⚙</button>
          </div>
        </div>
        <div id="ytm-lyrics-scroll-container">
          <div id="ytm-lyrics-list">
            <div class="ytm-empty-state">
              <div class="ytm-empty-icon">♫</div>
              <div class="ytm-empty-title">Ready for music</div>
              <div class="ytm-empty-sub">Play a track to view synchronized lyrics</div>
            </div>
          </div>
        </div>
        <button id="ytm-jump-active-btn" type="button">↓ Current Lyric</button>
      `;

      sidePanel.appendChild(lyricsContainer);

      lyricsContainer.querySelector('#ytm-pip-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerPiP();
      });

      lyricsContainer.querySelector('#ytm-gear-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPrefsModal();
      });

      const jumpBtn = lyricsContainer.querySelector('#ytm-jump-active-btn');
      jumpBtn?.addEventListener('click', () => {
        isUserScrolling = false;
        jumpBtn.classList.remove('visible');
        if (lastActiveIdx >= 0 && cachedDomRows[lastActiveIdx]) {
          scrollLyricsToElement(cachedDomRows[lastActiveIdx], true);
        }
      });

      const scrollContainer = lyricsContainer.querySelector('#ytm-lyrics-scroll-container');
      if (scrollContainer) {
        const handleUserScroll = () => {
          isUserScrolling = true;
          if (lastActiveIdx >= 0 && cachedDomRows.length > 0 && jumpBtn) {
            jumpBtn.classList.add('visible');
          }
          clearTimeout(userScrollTimeout);
          userScrollTimeout = setTimeout(() => {
            isUserScrolling = false;
            if (jumpBtn) jumpBtn.classList.remove('visible');
          }, 3500);
        };
        scrollContainer.addEventListener('wheel', handleUserScroll, { passive: true });
        scrollContainer.addEventListener('touchmove', handleUserScroll, { passive: true });
      }

      // If lyrics are already available in memory, render them
      if (lyricsData.length > 0) {
        renderLyricsDOM();
      } else if (lyricState === 'empty') {
        renderEmptyState();
      } else if (lyricState === 'searching') {
        renderSearchingState();
      } else if (lyricState === 'rate_limited') {
        renderRateLimitedState();
      }
    }

    setupTabsWatcher();
    updateTabVisibility();

    // Height-sync: Match side panel height to album art using ResizeObserver
    if (!sidePanelResizeObserver) {
      const sPanel = playerPage.querySelector('#side-panel');
      const mainPanel = playerPage.querySelector('#main-panel');
      if (sPanel && mainPanel) {
        let lastObservedArtType = null; // Track 'video' vs 'image' to detect switches
        let syncDebounceTimer = null;

        const syncHeight = () => {
          // Use mainPanel height as the consistent reference — it's managed by
          // YouTube Music's native layout and always reflects the correct available
          // height regardless of whether the content is a square art or 16:9 video.
          const mainRect = mainPanel.getBoundingClientRect();
          const panelHeight = mainRect.height;
          if (panelHeight > 100) {
            // Subtract bottom margin (12px) so panel doesn't touch the player bar
            const adjustedHeight = panelHeight - 12;
            sPanel.style.setProperty('max-height', `${adjustedHeight}px`, 'important');
            sPanel.style.setProperty('height', `${adjustedHeight}px`, 'important');
          }
        };

        // Debounced sync for content-type transitions (song↔video)
        const debouncedSync = () => {
          clearTimeout(syncDebounceTimer);
          syncDebounceTimer = setTimeout(() => {
            syncHeight();
            // Second pass after layout settles (video elements can be slow to finalize size)
            setTimeout(syncHeight, 300);
          }, 50);
        };

        // Detect when the content type changes (song art ↔ video)
        const checkContentSwitch = () => {
          const hasVideo = !!mainPanel.querySelector('#player video');
          const currentType = hasVideo ? 'video' : 'image';
          if (lastObservedArtType !== null && lastObservedArtType !== currentType) {
            // Content type switched — trigger re-sync with delays for layout to settle
            debouncedSync();
            // Additional delayed syncs to catch late layout shifts
            setTimeout(syncHeight, 500);
            setTimeout(syncHeight, 1000);
          }
          lastObservedArtType = currentType;
        };

        sidePanelResizeObserver = new ResizeObserver(() => {
          syncHeight();
          checkContentSwitch();
        });
        sidePanelResizeObserver.observe(mainPanel);

        // Watch for DOM changes inside mainPanel (song-image ↔ video swap)
        const contentObserver = new MutationObserver(() => {
          checkContentSwitch();
          debouncedSync();
        });
        contentObserver.observe(mainPanel, { childList: true, subtree: true });

        // Also sync on window resize for cases where the art scales
        window.addEventListener('resize', syncHeight);
        // Initial sync
        syncHeight();
        checkContentSwitch();
      }
    }
  }

  // 8. Robust LRC Parser (Multi-Timestamp & Fraction Aware)
  function parseLRC(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const result = [];
    const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(timeTagRegex)];
      if (!matches.length) continue;

      const lineText = line.replace(timeTagRegex, '').trim();
      if (!lineText) continue;

      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        let ms = 0;
        if (match[3]) {
          const rawMs = match[3];
          if (rawMs.length === 1) ms = parseInt(rawMs, 10) * 100;
          else if (rawMs.length === 2) ms = parseInt(rawMs, 10) * 10;
          else ms = parseInt(rawMs.padEnd(3, '0').slice(0, 3), 10);
        }
        const time = min * 60 + sec + ms / 1000;
        result.push({ time, text: lineText });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  }

  // 9. LRCLIB Client with Smart Caching & Anti-Rate-Limit Engine
  function fetchLyrics(rawTitle, rawArtist, duration) {
    if (!rawTitle) return;

    const requestId = ++activeRequestId;
    if (activeRequestHandle && typeof activeRequestHandle.abort === 'function') {
      try { activeRequestHandle.abort(); } catch (e) {}
    }

    lyricsData = [];
    cachedDomRows = [];
    lastActiveIdx = -1;

    const cleanTitle = cleanTrackTitle(rawTitle, rawArtist);
    const primaryArtist = getPrimaryArtist(rawArtist);
    const durSec = (duration && isFinite(duration) && duration > 0) ? Math.round(duration) : 0;
    const cacheKey = getCacheKey(rawTitle, rawArtist);

    // 1. Check in-memory & persistent cache
    if (lyricsMemoryCache.has(cacheKey)) {
      const cached = lyricsMemoryCache.get(cacheKey);
      if (cached.syncedLyrics) {
        lyricsData = parseLRC(cached.syncedLyrics);
        lyricState = 'found';
        renderLyricsDOM();
        drawPiPFrame();
        return;
      } else if (cached.plainLyrics) {
        lyricState = 'plain';
        renderPlainLyricsDOM(cached.plainLyrics);
        drawPiPFrame();
        return;
      } else if (cached.status === 'empty') {
        // Negative cache hit (within 2 hours)
        if (Date.now() - (cached.timestamp || 0) < 7200000) {
          lyricState = 'empty';
          renderEmptyState();
          drawPiPFrame();
          return;
        }
      }
    }

    // 2. Check if currently rate-limited by LRCLIB
    if (Date.now() < rateLimitUntil) {
      lyricState = 'rate_limited';
      renderRateLimitedState();
      drawPiPFrame();
      scheduleRateLimitRetry(rawTitle, rawArtist, duration);
      return;
    }

    // 3. Initiate Fetch Sequence
    lyricState = 'searching';
    drawPiPFrame();
    renderSearchingState();

    const headers = {
      'User-Agent': 'YTM-Glass/2.1.0 (Mac Safari PWA Userscript; https://github.com/ankrypht/ytm-glass)',
      'Lrclib-Client': 'YTM-Glass/2.1.0'
    };

    // Step 1: Direct exact match (/api/get) without forcing duration
    const stage1Url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(primaryArtist)}`;

    activeRequestHandle = GM_xmlhttpRequest({
      method: 'GET',
      url: stage1Url,
      headers: headers,
      timeout: 5000,
      onload: (res) => {
        if (requestId !== activeRequestId) return;

        if (res.status === 200) {
          try {
            const data = JSON.parse(res.responseText);
            if (data.syncedLyrics) {
              saveToLyricsCache(cacheKey, { syncedLyrics: data.syncedLyrics, plainLyrics: data.plainLyrics });
              lyricsData = parseLRC(data.syncedLyrics);
              lyricState = 'found';
              renderLyricsDOM();
              drawPiPFrame();
              return;
            } else if (data.plainLyrics) {
              saveToLyricsCache(cacheKey, { plainLyrics: data.plainLyrics });
              lyricState = 'plain';
              renderPlainLyricsDOM(data.plainLyrics);
              drawPiPFrame();
              return;
            } else if (data.instrumental) {
              saveToLyricsCache(cacheKey, { status: 'empty', timestamp: Date.now() });
              lyricState = 'empty';
              renderEmptyState();
              drawPiPFrame();
              return;
            }
          } catch (e) {}
        } else if (res.status === 429) {
          handleRateLimit(res, rawTitle, rawArtist, duration, requestId);
          return;
        }

        // Pacing delay to adhere to LRCLIB best practices before fallback search
        setTimeout(() => {
          if (requestId === activeRequestId) {
            stage2Search(cleanTitle, primaryArtist, durSec, cacheKey, requestId, rawTitle, rawArtist, headers);
          }
        }, 200);
      },
      ontimeout: () => {
        if (requestId === activeRequestId) {
          stage2Search(cleanTitle, primaryArtist, durSec, cacheKey, requestId, rawTitle, rawArtist, headers);
        }
      },
      onerror: () => {
        if (requestId === activeRequestId) {
          stage2Search(cleanTitle, primaryArtist, durSec, cacheKey, requestId, rawTitle, rawArtist, headers);
        }
      }
    });
  }

  function stage2Search(title, artist, targetDuration, cacheKey, requestId, rawTitle, rawArtist, headers) {
    if (requestId !== activeRequestId) return;

    // Structured field search gives far more accurate results than loose raw queries
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;

    activeRequestHandle = GM_xmlhttpRequest({
      method: 'GET',
      url: searchUrl,
      headers: headers,
      timeout: 5000,
      onload: (res) => {
        if (requestId !== activeRequestId) return;

        if (res.status === 200) {
          try {
            const results = JSON.parse(res.responseText);
            if (Array.isArray(results) && results.length > 0) {
              const candidates = results.filter(r => r.syncedLyrics && r.syncedLyrics.trim().length > 0);
              if (candidates.length > 0) {
                // If duration is known, choose closest candidate
                if (targetDuration > 0) {
                  candidates.sort((a, b) => Math.abs(a.duration - targetDuration) - Math.abs(b.duration - targetDuration));
                }
                const chosen = candidates[0];
                saveToLyricsCache(cacheKey, { syncedLyrics: chosen.syncedLyrics, plainLyrics: chosen.plainLyrics });
                lyricsData = parseLRC(chosen.syncedLyrics);
                lyricState = 'found';
                renderLyricsDOM();
                drawPiPFrame();
                return;
              }

              // Fallback to plain lyrics if synced lyrics aren't available
              const plainCandidates = results.filter(r => r.plainLyrics && r.plainLyrics.trim().length > 0);
              if (plainCandidates.length > 0) {
                const chosen = plainCandidates[0];
                saveToLyricsCache(cacheKey, { plainLyrics: chosen.plainLyrics });
                lyricState = 'plain';
                renderPlainLyricsDOM(chosen.plainLyrics);
                drawPiPFrame();
                return;
              }
            }
          } catch (e) {}
        } else if (res.status === 429) {
          handleRateLimit(res, rawTitle, rawArtist, targetDuration, requestId);
          return;
        }

        // Cache negative result so repeated plays don't spam requests
        saveToLyricsCache(cacheKey, { status: 'empty', timestamp: Date.now() });
        lyricState = 'empty';
        renderEmptyState();
        drawPiPFrame();
      },
      ontimeout: () => {
        if (requestId !== activeRequestId) return;
        saveToLyricsCache(cacheKey, { status: 'empty', timestamp: Date.now() });
        lyricState = 'empty';
        renderEmptyState();
        drawPiPFrame();
      },
      onerror: () => {
        if (requestId !== activeRequestId) return;
        saveToLyricsCache(cacheKey, { status: 'empty', timestamp: Date.now() });
        lyricState = 'empty';
        renderEmptyState();
        drawPiPFrame();
      }
    });
  }

  function handleRateLimit(res, rawTitle, rawArtist, duration, requestId) {
    if (requestId !== activeRequestId) return;

    let retrySec = 30;
    try {
      const headers = res.responseHeaders || '';
      const match = headers.match(/retry-after:\s*(\d+)/i);
      if (match) retrySec = Math.max(5, parseInt(match[1], 10));
    } catch (e) {}

    rateLimitUntil = Date.now() + (retrySec * 1000);
    lyricState = 'rate_limited';
    renderRateLimitedState();
    drawPiPFrame();
    scheduleRateLimitRetry(rawTitle, rawArtist, duration);
  }

  function scheduleRateLimitRetry(rawTitle, rawArtist, duration) {
    if (rateLimitTimer) clearInterval(rateLimitTimer);

    rateLimitTimer = setInterval(() => {
      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(rateLimitTimer);
        rateLimitTimer = null;
        if (currentSong.title === rawTitle && currentSong.artist === rawArtist) {
          fetchLyrics(rawTitle, rawArtist, duration);
        }
      } else {
        renderRateLimitedState();
        drawPiPFrame();
      }
    }, 1000);
  }

  // DOM Renderers
  function renderSearchingState() {
    const list = document.getElementById('ytm-lyrics-list');
    if (!list) return;
    list.innerHTML = `
      <div class="ytm-empty-state">
        <div class="ytm-empty-icon">♫</div>
        <div class="ytm-empty-title">Syncing lyrics...</div>
      </div>
    `;
    cachedDomRows = [];
  }

  function renderRateLimitedState() {
    const list = document.getElementById('ytm-lyrics-list');
    if (!list) return;
    const remainingSec = Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 1000));
    list.innerHTML = `
      <div class="ytm-empty-state">
        <div class="ytm-empty-icon">⏳</div>
        <div class="ytm-empty-title">Lyrics Server Rate Limited</div>
        <div class="ytm-empty-sub">Cooling down to preserve service quota (${remainingSec}s remaining). Will retry automatically.</div>
      </div>
    `;
    cachedDomRows = [];
  }

  function renderEmptyState() {
    const list = document.getElementById('ytm-lyrics-list');
    if (!list) return;
    list.innerHTML = `
      <div class="ytm-empty-state">
        <div class="ytm-empty-icon">♫</div>
        <div class="ytm-empty-title">Instrumental or No Lyrics</div>
        <div class="ytm-empty-sub">No synchronized lyrics found for this track</div>
        <button type="button" id="ytm-retry-btn" class="ytm-retry-btn">↻ Retry Lyrics</button>
      </div>
    `;
    cachedDomRows = [];

    const retryBtn = document.getElementById('ytm-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        const cacheKey = getCacheKey(currentSong.title, currentSong.artist);
        lyricsMemoryCache.delete(cacheKey);
        rateLimitUntil = 0;
        fetchLyrics(currentSong.title, currentSong.artist, currentSong.duration);
      });
    }
  }

  function renderPlainLyricsDOM(text) {
    const list = document.getElementById('ytm-lyrics-list');
    if (!list) return;
    list.innerHTML = `
      <div style="opacity:0.5; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:8px;">
        Static Lyrics (Unsynchronized)
      </div>
      <div class="ytm-plain-lyrics-view">${text}</div>
    `;
    cachedDomRows = [];
  }

  function renderLyricsDOM() {
    const list = document.getElementById('ytm-lyrics-list');
    if (!list) return;

    list.innerHTML = lyricsData.map((line, idx) => `
      <div class="ytm-lrc-row" id="ytm-lrc-${idx}" data-time="${line.time}">
        ${line.text}
      </div>
    `).join('');

    cachedDomRows = Array.from(list.querySelectorAll('.ytm-lrc-row'));
    cachedDomRows.forEach(row => {
      row.addEventListener('click', () => {
        const lineTime = parseFloat(row.getAttribute('data-time'));
        const offsetSec = (parseInt(prefs.timeOffsetMs, 10) || 0) / 1000;
        const targetTime = Math.max(0, lineTime - offsetSec);

        const player = getYTMPlayer();
        const video = getYTMVideo();

        if (player && typeof player.seekTo === 'function') {
          player.seekTo(targetTime, true);
        } else if (video && !isNaN(targetTime)) {
          video.currentTime = targetTime;
        }
        drawPiPFrame();
      });
    });
  }

  // 10. Player Event Hooks & Dynamic Video Tracking
  function getCurrentTrackInfo() {
    const video = getYTMVideo();
    const meta = navigator.mediaSession?.metadata;

    const titleEl = document.querySelector('.title.ytmusic-player-bar');
    const artistEl = document.querySelector('.byline.ytmusic-player-bar');
    const imgEl = document.querySelector('ytmusic-player-bar #thumbnail img') ||
                  document.querySelector('.image.ytmusic-player-bar');

    let title = meta?.title || (titleEl ? titleEl.textContent.trim() : '');
    let artist = meta?.artist || '';

    if (!artist && artistEl) {
      const raw = artistEl.textContent.trim();
      artist = raw.split('•')[0].trim();
    }

    let artwork = '';
    const playerPageImg = document.querySelector('ytmusic-player-page #song-image img');
    if (meta?.artwork && meta.artwork.length > 0) {
      artwork = meta.artwork[meta.artwork.length - 1].src;
    } else if (playerPageImg && playerPageImg.src) {
      artwork = playerPageImg.src;
    } else if (imgEl && imgEl.src) {
      artwork = imgEl.src;
    }

    const duration = (video && isFinite(video.duration) && video.duration > 0) ? video.duration : 0;
    return { title, artist, artwork, duration };
  }

  let hookedVideo = null;
  function bindVideoEvents(video) {
    if (!video || video === hookedVideo) return;
    hookedVideo = video;

    video.addEventListener('timeupdate', () => {
      lastPlayingTimestamp = Date.now();
      if (isPipActive) drawPiPFrame();

      if (!lyricsData.length || !cachedDomRows.length) return;

      const activeIdx = getActiveLyricIndex(video.currentTime);
      if (activeIdx === lastActiveIdx) return;

      if (lastActiveIdx >= 0 && cachedDomRows[lastActiveIdx]) {
        cachedDomRows[lastActiveIdx].classList.remove('active');
      }

      if (activeIdx >= 0 && cachedDomRows[activeIdx]) {
        const activeRow = cachedDomRows[activeIdx];
        activeRow.classList.add('active');
        if (!isUserScrolling) {
          scrollLyricsToElement(activeRow, true);
        }
      }
      lastActiveIdx = activeIdx;
    });

    video.addEventListener('pause', () => {
      if (isPipActive && pipVideo && !pipVideo.paused) {
        pipVideo.pause();
      }
      drawPiPFrame();
    });

    video.addEventListener('play', () => {
      lastPlayingTimestamp = Date.now();
      if (isPipActive && pipVideo && pipVideo.paused) {
        pipVideo.play().catch(() => {});
      }
      drawPiPFrame();
    });
  }

  function hookPlayer() {
    const video = getYTMVideo();
    if (video) {
      bindVideoEvents(video);
    }

    // Dynamic Polling for Track & Video Element Changes & Player Glass Injection
    setInterval(() => {
      ensurePlayerGlassInjected();

      const liveVideo = getYTMVideo();
      if (liveVideo && liveVideo !== hookedVideo) {
        bindVideoEvents(liveVideo);
      }

      const info = getCurrentTrackInfo();
      if (info.title) {
        // If artist DOM element is present but still loading text, wait 1 tick
        if (!info.artist && (document.querySelector('.byline.ytmusic-player-bar') || navigator.mediaSession?.metadata?.artist)) {
          return;
        }
        const effectiveArtist = info.artist || 'Unknown Artist';
        const key = `${info.title} - ${effectiveArtist}`;

        if (key !== currentKey) {
          currentKey = key;
          currentSong = { ...info, artist: effectiveArtist };

          const uiTitle = document.getElementById('ytm-ui-title');
          const uiArtist = document.getElementById('ytm-ui-artist');
          if (uiTitle) {
            uiTitle.textContent = info.title;
            setTimeout(() => {
              const container = document.getElementById('ytm-ui-title-container');
              if (container && uiTitle.scrollWidth > container.clientWidth) {
                uiTitle.classList.add('is-marquee');
              } else {
                uiTitle.classList.remove('is-marquee');
              }
            }, 60);
          }
          if (uiArtist) uiArtist.textContent = effectiveArtist;

          extractAlbumPalette(info.artwork);
          fetchLyrics(info.title, effectiveArtist, info.duration);
        } else {
          // Duration or artwork became available after initial song load
          if (info.duration > 0 && currentSong.duration !== info.duration) {
            currentSong.duration = info.duration;
          }
          if (info.artwork && currentSong.artwork !== info.artwork) {
            currentSong.artwork = info.artwork;
            extractAlbumPalette(info.artwork);
          }
        }
      }
    }, 1000);
  }

  // Boot Sequence
  initPiPCanvas();
  drawPiPFrame();
  startRenderLoop();
  injectPlayerGlassUI();
  hookPlayer();
})();