// ==UserScript==
// @name         YouTube Music Glass Synced Lyrics & PiP
// @namespace    https://github.com/ankrypht/ytm-glass-lyrics
// @version      1.2.2
// @description  Apple Music-style glass synced lyrics & native Picture-in-Picture for YouTube Music on Safari (macOS).
// @author       ankrypht
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/ankrypht/ytm-glass-lyrics
// @supportURL   https://github.com/ankrypht/ytm-glass-lyrics/issues
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
    pwaFontSize: 16,
    timeOffsetMs: 0,
    cardWidth: 350,
    cardHeight: 460,
    cardLeft: null,
    cardTop: null
  };

  let prefs = Object.assign({}, defaultPrefs);
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) prefs = Object.assign({}, defaultPrefs, JSON.parse(saved));
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
    lastExtractedUrl = imgUrl;

    if (paletteCache.has(imgUrl)) {
      activeTheme = paletteCache.get(imgUrl);
      applyTheme();
      drawPiPFrame();
      return;
    }

    const currentArtUrl = imgUrl;
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
          if (currentSong.artwork !== currentArtUrl) return; // Stale artwork check

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

            paletteCache.set(currentArtUrl, themeResult);
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
    const card = document.getElementById('ytm-glass-card');
    if (!card) return;

    const curAccent = prefs.syncAlbumArt ? activeTheme.accent : prefs.accentColor;
    const curBgStart = prefs.syncAlbumArt ? activeTheme.bgStart : prefs.bgStart;
    const curBgEnd = prefs.syncAlbumArt ? activeTheme.bgEnd : prefs.bgEnd;

    card.style.setProperty('--ytm-accent', curAccent);
    card.style.setProperty('--ytm-font', getCSSFont());
    card.style.setProperty('--ytm-pwa-font-size', `${prefs.pwaFontSize}px`);
    card.style.background = `linear-gradient(145deg, ${colorWithAlpha(curBgStart, 0.86)}, ${colorWithAlpha(curBgEnd, 0.94)})`;
  }

  // 4. Initializing Canvas Pipeline
  function initPiPCanvas() {
    if (canvas) return;

    canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 520;
    ctx = canvas.getContext('2d');

    pipVideo = document.createElement('video');
    pipVideo.id = 'ytm-pip-stream-video';
    pipVideo.muted = true;
    pipVideo.playsInline = true;
    pipVideo.autoplay = true;
    pipVideo.setAttribute('muted', '');
    pipVideo.setAttribute('playsinline', '');
    pipVideo.setAttribute('autoplay', '');

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

  // 7. Resizable & Draggable In-PWA Card UI
  function injectFloatingUI() {
    if (document.getElementById('ytm-glass-card')) return;

    const card = document.createElement('div');
    card.id = 'ytm-glass-card';

    // Restore saved card size or defaults
    const initialW = Math.max(300, Math.min(800, prefs.cardWidth || 350));
    const initialH = Math.max(240, Math.min(900, prefs.cardHeight || 460));
    card.style.width = `${initialW}px`;
    card.style.height = `${initialH}px`;

    // Restore saved position if valid
    if (prefs.cardLeft !== null && prefs.cardTop !== null) {
      const left = Math.max(10, Math.min(window.innerWidth - initialW - 10, parseInt(prefs.cardLeft, 10)));
      const top = Math.max(10, Math.min(window.innerHeight - initialH - 10, parseInt(prefs.cardTop, 10)));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.style.right = 'auto';
      card.style.bottom = 'auto';
    }

    card.innerHTML = `
      <div id="ytm-card-header">
        <div id="ytm-card-drag-handle">
          <span id="ytm-drag-indicator">⠿</span>
          <div id="ytm-track-meta">
            <div id="ytm-ui-title-container">
              <span id="ytm-ui-title">Waiting for playback...</span>
            </div>
            <div id="ytm-ui-artist">YouTube Music</div>
          </div>
        </div>
        <div id="ytm-actions">
          <button id="ytm-expand-btn" type="button" title="Expanded Mode (Theatre View)">⛶</button>
          <button id="ytm-gear-btn" type="button" title="Settings">⚙</button>
          <button id="ytm-pip-btn" type="button" title="Pop out over other apps (macOS PiP)">⤢ Pop Out</button>
          <button id="ytm-min-btn" type="button" title="Minimize">–</button>
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
      <div id="ytm-prefs-modal">
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
              <span>PWA Lyrics Font Size</span>
              <span id="pref-pwa-size-label">${prefs.pwaFontSize}px</span>
            </div>
            <input type="range" id="pref-pwa-size" min="13" max="22" step="1" value="${prefs.pwaFontSize}">
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
      <div id="ytm-resize-handle" title="Drag to resize window"></div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      :root {
        --ytm-accent: ${prefs.accentColor};
        --ytm-font: ${getCSSFont()};
        --ytm-pwa-font-size: ${prefs.pwaFontSize}px;
      }
      #ytm-glass-card {
        position: fixed; right: 28px; bottom: 100px; width: 350px; height: 460px;
        min-width: 300px; min-height: 240px; max-width: 800px; max-height: 900px;
        backdrop-filter: blur(32px) saturate(210%); -webkit-backdrop-filter: blur(32px) saturate(210%);
        border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 20px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06);
        color: #fff; z-index: 99999; display: flex; flex-direction: column; overflow: hidden;
        font-family: var(--ytm-font);
      }
      #ytm-glass-card.animating-bounds {
        transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      #ytm-glass-card.animating-height {
        transition: height 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      #ytm-glass-card.expanded {
        position: fixed !important;
        top: 20px !important;
        bottom: 96px !important;
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) !important;
        width: min(920px, calc(100vw - 48px)) !important;
        height: auto !important;
        border-radius: 24px !important;
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.14) !important;
        z-index: 99999 !important;
      }
      #ytm-glass-card.expanded #ytm-resize-handle { display: none !important; }
      #ytm-glass-card.expanded #ytm-card-drag-handle { cursor: default !important; }
      #ytm-glass-card.expanded #ytm-drag-indicator { display: none !important; }
      #ytm-glass-card.expanded .ytm-lrc-row {
        font-size: calc(var(--ytm-pwa-font-size) + 4px);
        line-height: 1.65;
        padding: 8px 14px;
      }
      #ytm-glass-card.expanded .ytm-lrc-row.active {
        font-size: calc(var(--ytm-pwa-font-size) + 8px);
      }
      #ytm-glass-card.minimized { height: 58px !important; min-height: 58px !important; }
      #ytm-glass-card.minimized #ytm-lyrics-scroll-container,
      #ytm-glass-card.minimized #ytm-prefs-modal,
      #ytm-glass-card.minimized #ytm-resize-handle { display: none !important; }
      #ytm-card-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08); user-select: none;
      }
      #ytm-card-drag-handle { display: flex; align-items: center; gap: 10px; cursor: grab; flex: 1; min-width: 0; }
      #ytm-card-drag-handle:active { cursor: grabbing; }
      #ytm-drag-indicator { opacity: 0.35; font-size: 16px; line-height: 1; }
      #ytm-track-meta { overflow: hidden; flex: 1; min-width: 0; padding-right: 8px; }
      #ytm-ui-title-container { overflow: hidden; white-space: nowrap; }
      #ytm-ui-title { display: inline-block; font-size: 13px; font-weight: 600; }
      #ytm-ui-title.is-marquee { animation: ytmMarquee 8s ease-in-out infinite alternate; }
      @keyframes ytmMarquee {
        0%, 20% { transform: translateX(0); }
        80%, 100% { transform: translateX(calc(-100% + 150px)); }
      }
      #ytm-ui-artist { font-size: 11px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ytm-accent); font-weight: 600; }
      #ytm-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      #ytm-actions button {
        background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.08);
        color: #eee; padding: 5px 9px; border-radius: 9px; font-size: 11px; font-weight: 600;
        cursor: pointer; transition: all 0.2s;
      }
      #ytm-actions button:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
      #ytm-actions button#ytm-pip-btn:hover { background: var(--ytm-accent); color: #fff; }

      #ytm-lyrics-scroll-container {
        flex: 1; overflow-y: auto; padding: 18px 16px; scroll-behavior: smooth;
        mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%);
      }
      #ytm-lyrics-scroll-container::-webkit-scrollbar { width: 4px; }
      #ytm-lyrics-scroll-container::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
      #ytm-lyrics-list { display: flex; flex-direction: column; gap: 14px; padding: 20px 0; }
      .ytm-lrc-row {
        opacity: 0.35; font-size: var(--ytm-pwa-font-size); line-height: 1.45; cursor: pointer;
        transition: all 0.2s ease; border-radius: 8px; padding: 4px 6px;
      }
      .ytm-lrc-row:hover { opacity: 0.85; background: rgba(255, 255, 255, 0.08); }
      .ytm-lrc-row.active {
        opacity: 1; font-weight: 700; font-size: calc(var(--ytm-pwa-font-size) + 2px);
        color: var(--ytm-accent); transform: scale(1.02); transform-origin: left center;
        text-shadow: 0 0 16px var(--ytm-accent);
      }
      .ytm-plain-lyrics-view {
        white-space: pre-wrap; font-size: var(--ytm-pwa-font-size); line-height: 1.6;
        opacity: 0.85; padding: 10px 4px;
      }

      #ytm-prefs-modal {
        position: absolute; inset: 0; background: rgba(10, 9, 14, 0.95);
        display: none; flex-direction: column; z-index: 10; padding: 16px;
      }
      #ytm-prefs-modal.active { display: flex; }
      .ytm-prefs-header {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 13px; font-weight: 700; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      #ytm-prefs-close { background: none; border: none; color: #aaa; font-size: 14px; cursor: pointer; }
      #ytm-prefs-close:hover { color: #fff; }
      .ytm-prefs-content { display: flex; flex-direction: column; gap: 16px; padding-top: 14px; overflow-y: auto; font-size: 12px; }
      .ytm-pref-toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }
      .ytm-pref-row { display: flex; justify-content: space-between; align-items: center; }
      .ytm-pref-row select { background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; }
      .ytm-pref-row input[type="color"] { border: none; width: 28px; height: 26px; border-radius: 4px; background: none; cursor: pointer; }
      .ytm-pref-col { display: flex; flex-direction: column; gap: 6px; }
      .ytm-pref-slider-meta { display: flex; justify-content: space-between; opacity: 0.8; }
      .ytm-pref-col input[type="range"] { accent-color: var(--ytm-accent); cursor: pointer; }

      #ytm-resize-handle {
        position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px;
        cursor: se-resize; background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.35) 50%);
        border-bottom-right-radius: 18px; z-index: 5;
      }
      .ytm-empty-state { text-align: center; padding: 50px 10px; user-select: none; }
      .ytm-empty-icon { font-size: 34px; color: var(--ytm-accent); margin-bottom: 8px; opacity: 0.85; }
      .ytm-empty-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
      .ytm-empty-sub { font-size: 12px; color: rgba(255, 255, 255, 0.45); line-height: 1.4; margin-bottom: 12px; }
      .ytm-retry-btn {
        background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fff; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
        cursor: pointer; transition: all 0.2s;
      }
      .ytm-retry-btn:hover { background: var(--ytm-accent); border-color: var(--ytm-accent); }
      #ytm-jump-active-btn {
        position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%) translateY(15px);
        background: var(--ytm-accent); color: #fff; border: none; border-radius: 20px;
        padding: 6px 14px; font-size: 11px; font-weight: 700; cursor: pointer;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45); opacity: 0; pointer-events: none;
        transition: all 0.25s ease; z-index: 5;
      }
      #ytm-jump-active-btn.visible {
        opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(card);

    // Add Jump to Current Lyric pill
    const jumpBtn = document.createElement('button');
    jumpBtn.id = 'ytm-jump-active-btn';
    jumpBtn.type = 'button';
    jumpBtn.textContent = '↓ Current Lyric';
    card.appendChild(jumpBtn);

    applyTheme();
    setupDraggable(card);
    setupResizable(card);

    const scrollContainer = card.querySelector('#ytm-lyrics-scroll-container');
    if (scrollContainer) {
      const handleUserScroll = () => {
        isUserScrolling = true;
        if (lastActiveIdx >= 0 && cachedDomRows.length > 0) {
          jumpBtn.classList.add('visible');
        }
        clearTimeout(userScrollTimeout);
        userScrollTimeout = setTimeout(() => {
          isUserScrolling = false;
          jumpBtn.classList.remove('visible');
        }, 3500);
      };
      scrollContainer.addEventListener('wheel', handleUserScroll, { passive: true });
      scrollContainer.addEventListener('touchmove', handleUserScroll, { passive: true });
    }

    jumpBtn.addEventListener('click', () => {
      isUserScrolling = false;
      jumpBtn.classList.remove('visible');
      if (lastActiveIdx >= 0 && cachedDomRows[lastActiveIdx]) {
        cachedDomRows[lastActiveIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    const prefsModal = card.querySelector('#ytm-prefs-modal');
    card.querySelector('#ytm-gear-btn')?.addEventListener('click', () => {
      prefsModal?.classList.add('active');
    });
    card.querySelector('#ytm-prefs-close')?.addEventListener('click', () => {
      prefsModal?.classList.remove('active');
    });

    const syncCb = card.querySelector('#pref-sync-album');
    const accentRow = card.querySelector('#pref-accent-row');
    if (syncCb && accentRow) {
      syncCb.addEventListener('change', () => {
        prefs.syncAlbumArt = syncCb.checked;
        accentRow.style.opacity = prefs.syncAlbumArt ? '0.4' : '1';
        accentRow.style.pointerEvents = prefs.syncAlbumArt ? 'none' : 'auto';
        extractAlbumPalette(currentSong.artwork);
        savePrefs();
      });
    }

    card.querySelector('#pref-accent-color')?.addEventListener('input', (e) => {
      prefs.accentColor = e.target.value;
      savePrefs();
    });

    const fontSelect = card.querySelector('#pref-font-family');
    if (fontSelect) {
      fontSelect.value = prefs.fontFamily;
      fontSelect.addEventListener('change', (e) => {
        prefs.fontFamily = e.target.value;
        savePrefs();
      });
    }

    const pipSlider = card.querySelector('#pref-pip-size');
    const pipLabel = card.querySelector('#pref-pip-size-label');
    if (pipSlider) {
      pipSlider.addEventListener('input', (e) => {
        prefs.pipFontSize = e.target.value;
        if (pipLabel) pipLabel.textContent = `${prefs.pipFontSize}px`;
        savePrefs();
      });
    }

    const pwaSlider = card.querySelector('#pref-pwa-size');
    const pwaLabel = card.querySelector('#pref-pwa-size-label');
    if (pwaSlider) {
      pwaSlider.addEventListener('input', (e) => {
        prefs.pwaFontSize = e.target.value;
        if (pwaLabel) pwaLabel.textContent = `${prefs.pwaFontSize}px`;
        savePrefs();
      });
    }

    const offsetSlider = card.querySelector('#pref-offset-slider');
    const offsetLabel = card.querySelector('#pref-offset-label');
    if (offsetSlider) {
      offsetSlider.addEventListener('input', (e) => {
        prefs.timeOffsetMs = parseInt(e.target.value, 10);
        if (offsetLabel) offsetLabel.textContent = `${(prefs.timeOffsetMs / 1000).toFixed(1)}s`;
        savePrefs();
      });
    }

    const expandBtn = card.querySelector('#ytm-expand-btn');
    let prevBounds = null;

    function toggleExpand() {
      const isExpanded = card.classList.contains('expanded');
      card.classList.add('animating-bounds');

      if (isExpanded) {
        card.classList.remove('expanded');
        if (expandBtn) {
          expandBtn.textContent = '⛶';
          expandBtn.title = 'Expanded Mode (Theatre View)';
        }
        if (prevBounds) {
          card.style.left = prevBounds.left || '';
          card.style.top = prevBounds.top || '';
          card.style.width = prevBounds.width || '';
          card.style.height = prevBounds.height || '';
          card.style.right = prevBounds.right || '';
          card.style.bottom = prevBounds.bottom || '';
          card.style.transform = '';
        }
      } else {
        if (card.classList.contains('minimized')) {
          card.classList.remove('minimized');
          if (minBtn) minBtn.textContent = '–';
        }
        prevBounds = {
          left: card.style.left,
          top: card.style.top,
          width: card.style.width,
          height: card.style.height,
          right: card.style.right,
          bottom: card.style.bottom
        };
        card.classList.add('expanded');
        if (expandBtn) {
          expandBtn.textContent = '🗗';
          expandBtn.title = 'Exit Expanded Mode (Esc)';
        }
      }

      setTimeout(() => {
        card.classList.remove('animating-bounds');
      }, 300);
    }

    expandBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpand();
    });

    card.querySelector('#ytm-pip-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerPiP();
    });

    const minBtn = card.querySelector('#ytm-min-btn');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        card.classList.add('animating-height');
        card.classList.toggle('minimized');
        minBtn.textContent = card.classList.contains('minimized') ? '+' : '–';
        setTimeout(() => { card.classList.remove('animating-height'); }, 300);
      });
    }

    // Double click header to toggle minimize/maximize or exit expanded mode (macOS standard)
    const dragHandle = card.querySelector('#ytm-card-drag-handle');
    if (dragHandle) {
      dragHandle.addEventListener('dblclick', () => {
        if (card.classList.contains('expanded')) {
          toggleExpand();
        } else {
          card.classList.add('animating-height');
          card.classList.toggle('minimized');
          if (minBtn) minBtn.textContent = card.classList.contains('minimized') ? '+' : '–';
          setTimeout(() => { card.classList.remove('animating-height'); }, 300);
        }
      });
    }

    // Global keyboard shortcuts: Option+P for PiP, Escape for Expanded Mode, Option+Arrow for 10s Seek
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'Escape' && card.classList.contains('expanded')) {
        toggleExpand();
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
  }

  function setupDraggable(el) {
    const handle = el.querySelector('#ytm-card-drag-handle');
    if (!handle) return;
    let offsetX = 0, offsetY = 0, isDragging = false;

    handle.addEventListener('mousedown', (e) => {
      if (el.classList.contains('expanded')) return;
      isDragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const left = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, e.clientX - offsetX));
      const top = Math.max(10, Math.min(window.innerHeight - el.offsetHeight - 10, e.clientY - offsetY));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        prefs.cardLeft = el.style.left;
        prefs.cardTop = el.style.top;
        savePrefs();
      }
    });

    window.addEventListener('resize', () => {
      if (!el.style.left || el.classList.contains('expanded')) return;
      const curLeft = parseInt(el.style.left, 10);
      const curTop = parseInt(el.style.top, 10);
      const maxLeft = Math.max(10, window.innerWidth - el.offsetWidth - 10);
      const maxTop = Math.max(10, window.innerHeight - el.offsetHeight - 10);
      if (curLeft > maxLeft) el.style.left = maxLeft + 'px';
      if (curTop > maxTop) el.style.top = maxTop + 'px';
    });
  }

  function setupResizable(el) {
    const handle = el.querySelector('#ytm-resize-handle');
    if (!handle) return;
    let isResizing = false, startW = 0, startH = 0, startX = 0, startY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (el.classList.contains('expanded')) return;
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = el.offsetWidth;
      startH = el.offsetHeight;

      // Fix coordinate anchoring: convert right/bottom to left/top so resizing tracks mouse naturally
      const rect = el.getBoundingClientRect();
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';

      document.body.style.userSelect = 'none';
      e.stopPropagation();
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newW = Math.max(300, Math.min(800, startW + (e.clientX - startX)));
      const newH = Math.max(240, Math.min(900, startH + (e.clientY - startY)));
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = '';
        prefs.cardWidth = el.offsetWidth;
        prefs.cardHeight = el.offsetHeight;
        prefs.cardLeft = el.style.left;
        prefs.cardTop = el.style.top;
        savePrefs();
      }
    });
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
      'User-Agent': 'YTM-Glass-Lyrics/1.2.2 (Mac Safari PWA Userscript; https://github.com/ankrypht/ytm-glass-lyrics)',
      'Lrclib-Client': 'YTM-Glass-Lyrics/1.2.2'
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
    if (meta?.artwork && meta.artwork.length > 0) {
      artwork = meta.artwork[meta.artwork.length - 1].src;
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
          activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    // Dynamic Polling for Track & Video Element Changes
    setInterval(() => {
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
  injectFloatingUI();
  hookPlayer();
})();