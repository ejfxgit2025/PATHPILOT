console.log('[PATHPILOT] Future Decision Sidecar — content active.');

// ─── Performance layer ────────────────────────────────────────────────────────
// STEP 1 — Debounce: run detectPage only after user stops activity (0.8s)
let _scanDebounceTimer = null;
function _scheduleScan() {
  if (!chrome.runtime?.id) return;
  clearTimeout(_scanDebounceTimer);
  _scanDebounceTimer = setTimeout(() => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => detectPage(), { timeout: 1500 });
    } else {
      detectPage();
    }
  }, 800);
}
window.addEventListener('scroll',  _scheduleScan, { passive: true });
window.addEventListener('click',   _scheduleScan, { passive: true });
window.addEventListener('keydown', _scheduleScan, { passive: true });

// STEP 2 — URL + result cache: skip re-scan on same URL
let _cachedScanUrl    = '';
let _cachedScanResult = null;

// STEP 4 — DOM text cache: only re-extract when URL changes
let _cachedBodyText = '';
let _cachedBodyUrl  = '';
function _getFastBodyText() {
  if (location.href === _cachedBodyUrl && _cachedBodyText) return _cachedBodyText;
  _cachedBodyUrl  = location.href;
  _cachedBodyText = (document.body?.innerText || '').slice(0, 300);
  return _cachedBodyText;
}

// STEP 7 — AI throttle: max 1 classification call per 3s
let _lastClassifyTime = 0;

// ─── Unicode sanitization (mirrors backend utils/sanitize.js) ────────────────
function cleanPageText(text) {
  if (!text) return '';
  return text
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Stop-words for input keyword extraction ──────────────────────────────────
const INPUT_STOP_WORDS = new Set([
  'a','an','the','and','or','to','for','of','in','on','at','be',
  'is','are','was','i','my','me','we','it','this','that','how',
  'what','why','when','can','do','does','did','get','got','has',
]);

// Top-level state
let lastType   = 'neutral';
let currentGoal = '';

// ── Time-on-page tracking ─────────────────────────────────────────────────────
const _pageLoadTime = Date.now();
function getTimeOnPage() {
  return Math.round((Date.now() - _pageLoadTime) / 1000); // seconds
}

// ── Input keyword capture ─────────────────────────────────────────────────────
// Passive listener — never captures password fields.
// Max 5 meaningful words extracted from the last typed text.
let _lastInputText = '';

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el) return;
  if (el.type === 'password' || el.type === 'hidden') return;
  const raw = (el.value || el.textContent || '').slice(0, 200);
  if (raw.trim().length > 1) _lastInputText = raw.trim();
}, { passive: true, capture: true });

function getInputKeywords() {
  if (!_lastInputText) return [];
  return _lastInputText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !INPUT_STOP_WORDS.has(w))
    .slice(0, 5);
}

// ── Page Type Detection ───────────────────────────────────────────────────────
// Detects functional type of the current page from URL patterns + DOM fallback.
// Returns: 'chat' | 'editor' | 'docs' | 'video' | 'social' | 'search' | 'code' | 'unknown'
// Pure heuristic — zero API cost, <1ms.

const PAGE_TYPE_RULES = [
  { type: 'chat',   test: (u) => /claude\.ai|chat\.openai|gemini\.google|chatgpt|poe\.com|character\.ai|perplexity\.ai|phind\.com/i.test(u) },
  { type: 'editor', test: (u) => /codesandbox|codepen\.io|repl\.it|replit\.com|stackblitz|jsfiddle|jsbin|glitch\.me|vscode\.dev|github\.dev|codespace/i.test(u) },
  { type: 'video',  test: (u) => /youtube\.com|youtu\.be|vimeo\.com|loom\.com\/share|twitch\.tv|dailymotion/i.test(u) },
  { type: 'social', test: (u) => /twitter\.com|x\.com|instagram\.com|facebook\.com|linkedin\.com\/feed|tiktok\.com|threads\.net|reddit\.com\/(hot|new|rising|top)|snapchat/i.test(u) },
  { type: 'search', test: (u) => /google\.com\/search|bing\.com\/search|duckduckgo\.com|search\.yahoo|yandex/i.test(u) },
  { type: 'docs',   test: (u) => /docs\.|developer\.|mdn\.io|w3schools|freecodecamp|learn\.|stackoverflow|devdocs|python\.org\/doc|docs\.python|readme\.io|gitbook/i.test(u) },
  { type: 'code',   test: (u) => /github\.com|gitlab\.com|bitbucket\.org|codereview|gerrit/i.test(u) },
];

function detectPageType(url) {
  for (const rule of PAGE_TYPE_RULES) {
    if (rule.test(url)) return rule.type;
  }
  // DOM fallbacks
  try {
    if (document.querySelector('video[src], video source')) return 'video';
    if (document.querySelectorAll('textarea').length >= 1)  return 'editor';
  } catch (_) { /* ignore */ }
  return 'unknown';
}

// ── Keep goal updated ─────────────────────────────────────────────────────────
function syncGoal() {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      void chrome.runtime.lastError;
      if (state && state.userGoal) currentGoal = state.userGoal;
    });
  } catch(e) {}
}
syncGoal();

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PAGE') {
    const url        = window.location.href;
    const title      = document.title;
    const pageType   = detectPageType(url);
    const inputKws   = getInputKeywords();
    const timeOnPage = getTimeOnPage();

    const h1   = cleanPageText(document.querySelector('h1')?.innerText || '');
    // STEP 4 — use cached/sliced text for performance
    const text = cleanPageText(_getFastBodyText()).slice(0, 300);

    sendResponse({
      url,
      title,
      h1,
      text,
      pageType,                          // 'chat'|'editor'|'docs'|'video'|'social'|'search'|'code'|'unknown'
      inputKeywords:    inputKws,        // string[], max 5
      hasTypingActivity: inputKws.length > 0,
      timeOnPage,                        // seconds since page load
    });

  } else if (request.type === 'SHOW_BORDER') {
    showBorder(request.level);
  } else if (request.type === 'CLEAR_WARNING') {
    clearWarning();
  } else if (request.type === 'STATE_UPDATED') {
    if (request.state && request.state.userGoal) {
      currentGoal = request.state.userGoal;
    }
  }
});

// ── Existing scoring helpers (unchanged) ──────────────────────────────────────
function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function getScore(goal, text) {
  if (!goal) return 0;
  const words = normalize(goal).split(" ").filter(w => w.trim() !== "");
  if (words.length === 0) return 0;
  const content = normalize(text);
  let match = 0;
  words.forEach(w => {
    if (w.length > 2 && content.includes(w)) {
      match++;
    } else if (w.length <= 2 && content.includes(` ${w} `)) {
      match++;
    }
  });
  return (match / words.length) * 100;
}

function detectPage() {
  // STEP 2 — skip if URL unchanged and we already have a result
  const url = location.href;
  if (url === _cachedScanUrl && _cachedScanResult !== null) {
    sendClassification(_cachedScanResult);
    return;
  }

  // STEP 7 — throttle: max once per 3s
  const now = Date.now();
  if (now - _lastClassifyTime < 3000) return;
  _lastClassifyTime = now;

  const title    = cleanPageText(document.title);
  const goal     = currentGoal || '';
  const combined = title + ' ' + url;
  const score    = getScore(goal, combined);
  let type       = 'neutral';
  if (goal.trim().length > 0) {
    type = score >= 50 ? 'focus' : 'waste';
  }

  // Cache for same-URL deduplication
  _cachedScanUrl    = url;
  _cachedScanResult = type;

  sendClassification(type);
}

function sendClassification(type) {
  lastType = type;
  // Guard: bail out if the extension context has been invalidated (e.g. after reload)
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage(
      { type: 'UPDATE_PAGE_TYPE', pageType: type },
      () => { void chrome.runtime.lastError; }  // consume error — no throw
    );
  } catch(e) {}
}

// STEP 8 — run loop via idle callback so it never blocks rendering
// Fallback to setInterval for browsers without requestIdleCallback
function _scheduleDetectLoop() {
  if (!chrome.runtime?.id) return; // Terminate loop if extension reloaded
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      detectPage();
      setTimeout(_scheduleDetectLoop, 5000);
    }, { timeout: 6000 });
  } else {
    setTimeout(_scheduleDetectLoop, 5000);
  }
}
_scheduleDetectLoop();


// Instant navigation detection — 1s poll (reduced from 500ms)
// Clears caches on navigation so new-page scan always runs fresh
let lastDetectedUrl = location.href;
const _navInterval = setInterval(() => {
  if (!chrome.runtime?.id) {
    clearInterval(_navInterval);
    return; // Terminate loop if extension reloaded
  }
  if (location.href !== lastDetectedUrl) {
    lastDetectedUrl    = location.href;
    _cachedScanUrl     = '';   // force re-scan on URL change
    _cachedScanResult  = null;
    _cachedBodyText    = '';   // invalidate text cache
    _lastClassifyTime  = 0;   // reset throttle for new page
    _scheduleScan();
  }
}, 1000);

// ─── Time-based enforcement ───────────────────────────────────────────────────
(function initEnforcement() {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      void chrome.runtime.lastError;
      if (chrome.runtime.lastError || !state || !state.isMonitoring) return;
      // Enforcement is fully message-driven from background.js
    });
  } catch(e) {}
})();

// ─── SPA navigation detection ─────────────────────────────────────────────────
let _lastSentinelUrl = location.href;
new MutationObserver(() => {
  if (location.href !== _lastSentinelUrl) {
    _lastSentinelUrl = location.href;
  }
}).observe(document, { subtree: true, childList: true });

// ─── Warning Border System ────────────────────────────────────────────────────
function showBorder(level) {
  let border = document.getElementById('sentinel-border-warning');
  if (!border) {
    border = document.createElement('div');
    border.id = 'sentinel-border-warning';
    let style = document.getElementById('sentinel-border-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sentinel-border-style';
      style.textContent = `
        @keyframes sentinelPulse {
          0% { box-shadow: inset 0 0 20px rgba(255,0,60,0.6); }
          50% { box-shadow: inset 0 0 80px rgba(255,0,60,1); }
          100% { box-shadow: inset 0 0 20px rgba(255,0,60,0.6); }
        }
        @keyframes sentinelPulseMedium {
          0% { box-shadow: inset 0 0 10px rgba(255,120,0,0.5); }
          50% { box-shadow: inset 0 0 40px rgba(255,120,0,0.9); }
          100% { box-shadow: inset 0 0 10px rgba(255,120,0,0.5); }
        }
      `;
      document.head.appendChild(style);
    }
    border.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none; z-index: 2147483647; box-sizing: border-box;
    `;
    document.documentElement.appendChild(border);
  }
  if (level === 'medium') {
    border.style.border = '4px solid rgba(255,120,0,0.8)';
    border.style.boxShadow = 'inset 0 0 30px rgba(255,120,0,0.7)';
    border.style.animation = 'sentinelPulseMedium 1s infinite';
  } else if (level === 'high') {
    border.style.border = '6px solid rgba(255,0,60,0.95)';
    border.style.boxShadow = 'inset 0 0 60px rgba(255,0,60,0.9)';
    border.style.animation = 'sentinelPulse 1s infinite';
  }
}

function clearWarning() {
  const border = document.getElementById('sentinel-border-warning');
  if (border) border.remove();
}

// ─── Voice helper ─────────────────────────────────────────────────────────────
function speak(text) {
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage(
      { type: 'PLAY_VOICE_CMD', text },
      () => { void chrome.runtime.lastError; }  // consume error — no throw
    );
  } catch(e) {}
}
