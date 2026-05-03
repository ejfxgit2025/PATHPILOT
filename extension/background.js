console.log('[PATHPILOT] Future Decision Sidecar — service worker initialized.');

const BACKEND_URL     = 'http://localhost:3001';
const FALLBACK_SECRET = 'sentinel-123';

// ── STEP 5 — fetchWithTimeout: prevent UI freeze on slow backend ──────────
function fetchWithTimeout(url, options, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── STEP 6 — Global AbortController for page analysis (cancel stale calls) ──
let _analyzeController = null;

// ── SINGLE SOURCE OF TRUTH — Goal State ──────────────────────────────────────
// ALL goal reads must use currentGoal. Never read state.userGoal directly.
let currentGoal = '';
// Monotonically-increasing version. Bumped on every goal change.
// analyzePageData() captures the version at call time and discards the result
// if a newer goal has been set by the time the response arrives.
let goalVersion = 0;
// ─────────────────────────────────────────────────────────────────────────────

let state = {
  userGoal: '',
  strictMode: false,
  isMonitoring: false,   // ← must be explicitly started
  focusTime: 0,
  wastedTime: 0,
  sessionStart: Date.now(),
  distractionCount: 0,
  currentPageScore: 100,
  allowedSites: [],
  taskList: [],
  urlHistory: [],
  memoryLog: [],
  lastScanTime: Date.now(),
  secretKey: '',
  // Time-based enforcement
  distractionStartTime: null,
  warningShown: false,
  currentTaskURL: '',
  activeWarningTimer: null,
  // Single timer engine
  currentMode: 'neutral',
  lastSafeUrl: '',
  safeUrlHistory: [],
  currentPageType: 'neutral',
  lastTick: Date.now()
};

// ── Request Cooldown — prevents API spam ─────────────────────────────────────
// One analysis call per URL per 60 seconds maximum.
// Fires on tab switch + 30s alarm + tab.onUpdated — without this, a single
// navigation can queue 3-5 calls. 60s = safe for hackathon demo + low cost.
const ANALYSIS_COOLDOWN_MS = 60_000;
const _lastAnalysisByUrl   = {};

function canRunAnalysis(url) {
  const now  = Date.now();
  const last = _lastAnalysisByUrl[url] || 0;
  if (now - last < ANALYSIS_COOLDOWN_MS) {
    console.log(`[PATHPILOT] ⏱ Cooldown active for ${url} — skipping (${Math.round((ANALYSIS_COOLDOWN_MS - (now - last)) / 1000)}s remaining)`);
    return false;
  }
  _lastAnalysisByUrl[url] = now;
  // Prune old entries so the map doesn't grow forever
  const cutoff = now - ANALYSIS_COOLDOWN_MS * 10;
  for (const k of Object.keys(_lastAnalysisByUrl)) {
    if (_lastAnalysisByUrl[k] < cutoff) delete _lastAnalysisByUrl[k];
  }
  return true;
}

/**
 * emitFallbackResult — sent to sidepanel when the backend is unreachable.
 * Guarantees the UI always shows meaningful data even during outages.
 * Never throws.
 */
function emitFallbackResult(url, title) {
  const fallback = {
    score:      50,
    status:     'warning',
    level:      'warning',
    message:    'System offline — baseline analysis active.',
    action:     'warn',
    category:   'unknown',
    suggestions: [],
    reason:     'Backend unreachable. PathPilot is operating in offline fallback mode.',
    modelUsed:  'offline-fallback',
    latency:    0,
    fallback:   true,
    pageTitle:  title || url || 'Current page',
  };
  // Update local state so time tracking isn't broken
  state.currentPageScore = fallback.score;
  chrome.runtime.sendMessage({ type: 'AI_RESULT', data: fallback }).catch(() => { });
}

// Load state from storage
// Also loads the 'goal' key independently so the single-source-of-truth
// currentGoal is always set from the latest saved value, not from the
// potentially-stale sentinelState blob.
chrome.storage.local.get(['sentinelState', 'SENTINEL_SECRET', 'strictMode', 'goal'], (result) => {
  if (result.sentinelState) {
    state = { ...state, ...result.sentinelState };
  }
  // Top-level strictMode key overrides sentinelState (more frequently updated)
  if (typeof result.strictMode === 'boolean') {
    state.strictMode = result.strictMode;
  }
  if (result.SENTINEL_SECRET) {
    state.secretKey = result.SENTINEL_SECRET;
  }
  // Safe default — ensure currentMode is always valid
  if (!state.currentMode) {
    state.currentMode = 'neutral';
  }
  // ── Restore latest goal into SSOT ────────────────────────────────────────
  // Priority: top-level 'goal' key > sentinelState.userGoal
  if (result.goal) {
    currentGoal = result.goal;
    state.userGoal = result.goal;
  } else if (state.userGoal) {
    currentGoal = state.userGoal;
  }
  state.lastTick = Date.now();
  console.log('[DISCIPLINE MODE]', state.strictMode);
  console.log('[PATHPILOT] Goal restored:', currentGoal || '(none)');
});

// ─── SINGLE TIMER ENGINE ──────────────────────────────────────────────────────
setInterval(() => {
  if (!state.isMonitoring) return;

  if (state.currentMode === 'focus') {
    state.focusTime += 5000;
  } else if (state.currentMode === 'waste') {
    state.wastedTime += 5000;
  }

  // ─── Strict Mode 2-Minute Timer ─────────────────────────────────────────────
  if (state.strictMode) {
    if (state.currentMode === 'waste') {
      if (!state.activeWarningTimer) {
        state.activeWarningTimer = Date.now();
      } else if (Date.now() - state.activeWarningTimer >= 120000) {
        // Reset the timer since block is triggered
        state.activeWarningTimer = null;
      }
    } else {
      // Not a waste page, reset warning timer
      state.activeWarningTimer = null;
    }
  } else {
    state.activeWarningTimer = null; // Strict mode off, clear timer
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Compute focus score for the UI
  const total = state.focusTime + state.wastedTime;
  const focusScore = total > 0 ? Math.round((state.focusTime / total) * 100) : null;
  state.focusScore = focusScore;

  chrome.storage.local.set({ sentinelState: state });
  // Send STATS_UPDATE
  chrome.runtime.sendMessage({
    type: 'STATS_UPDATE',
    focusTime: state.focusTime,
    wastedTime: state.wastedTime,
    score: focusScore
  }).catch(() => { });
}, 5000);

// Keep strictMode in sync whenever popup or sidepanel toggle changes it
async function enforceStrictMode(tabId, isStrict) {
  try {
    let targetTab = null;
    if (tabId) {
      targetTab = await chrome.tabs.get(tabId).catch(() => null);
    }
    if (!targetTab) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTab = tabs[0];
    }
    if (targetTab && targetTab.id) {
      if (isStrict) {
        performScan(targetTab);
      } else {
        chrome.tabs.sendMessage(targetTab.id, { type: 'CLEAR_WARNING' }).catch(() => { });
      }
    }
  } catch (err) {
    console.error('[PATHPILOT] enforceStrictMode error:', err);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.strictMode) {
    state.strictMode = changes.strictMode.newValue;
    console.log('[DISCIPLINE MODE] Storage changed →', state.strictMode);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0] ? tabs[0].id : null;
      enforceStrictMode(activeTabId, state.strictMode);
    });
  }
});

function saveState() {
  chrome.storage.local.set({ sentinelState: state });
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state }).catch(() => { });
}

function getEffectiveKey() {
  return state.secretKey || FALLBACK_SECRET;
}

/**
 * getEffectiveGoal — ALWAYS returns the single source of truth.
 * Never reads state.userGoal directly anywhere else in this file.
 */
function getEffectiveGoal() {
  return currentGoal || state.userGoal || 'become a successful founder';
}

/**
 * applyNewGoal — canonical goal-update routine.
 * Call this EVERY time the goal changes (SET_GOAL handler, storage load, etc.)
 * 1. Updates SSOT (currentGoal)
 * 2. Bumps goalVersion so in-flight stale responses are discarded
 * 3. Syncs state.userGoal for backward compat
 * 4. Persists to chrome.storage
 * 5. Clears per-URL cooldown for current tab so fresh scan runs immediately
 * 6. Triggers a fresh performScan
 */
function applyNewGoal(newGoal) {
  if (!newGoal || newGoal === currentGoal) return;
  currentGoal = newGoal;
  goalVersion = Date.now(); // bump version — stale responses will be ignored
  state.userGoal = newGoal;
  // Persist as both the SSOT 'goal' key and inside sentinelState
  chrome.storage.local.set({ goal: currentGoal, sentinelState: state });
  console.log(`[PATHPILOT] Goal updated → "${currentGoal}" (v${goalVersion})`);
  // Clear cooldown for the active tab URL so re-analysis runs immediately
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      delete _lastAnalysisByUrl[tabs[0].url];
      console.log('[PATHPILOT] Cooldown cleared for', tabs[0].url);
    }
    // Kick off fresh scan with the new goal
    performScan();
  });
}

function getRedirectUrl() {
  const last = state.lastSafeUrl || '';
  if (last && last.startsWith('http')) {
    return last;
  }
  return 'chrome://newtab';
}

// Setup alarm-based scan (every 30s fallback — skipped when page-data cache is fresh)
chrome.alarms.create('scanPage', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'scanPage') return;
  // STEP 7 / STEP 2 — skip alarm-fired scan if the active tab's URL is
  // still within the 30s page-data freshness window. This prevents the
  // periodic alarm from tripling backend calls on the same page.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;
    const cached = _pageDataCache[tab.url];
    if (cached && (Date.now() - cached.ts) < PAGE_DATA_CACHE_MS) {
      console.log('[PATHPILOT] ⏭ Alarm skipped — cache fresh for', tab.url);
      return;
    }
    performScan(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    // Invalidate stale cache entry for old URL so next scan is always fresh
    if (tab.url && _pageDataCache[tab.url]) {
      delete _pageDataCache[tab.url];
      console.log('[PATHPILOT] 🗑 Cache invalidated on navigation:', tab.url);
    }
    performScan(tab);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.status === 'complete') {
      performScan(tab);
    }
  });
});

// Send a message to a tab — ping first to avoid redundant injection.
// Only injects content.js when the content script is not yet alive on that tab.
async function sendToTab(tabId, message) {
  try {
    // Fast path: try sending directly (content script already alive)
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_pingErr) {
    // Slow path: inject content script then retry once
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // One tick for the listener to register
      await new Promise(r => setTimeout(r, 0));
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    } catch (err) {
      console.error('[PATHPILOT] INJECTION FAILED:', err);
    }
  }
}

// ── STEP 4 — Page-data cache: avoid re-injecting content script on same URL ──
// Cache keyed by URL. Content script is only (re-)injected when the cached
// entry is missing or older than PAGE_DATA_CACHE_MS. This eliminates the
// redundant 300ms artificial delay and prevents double-injection on the same
// page within the freshness window.
const _pageDataCache     = {};
const PAGE_DATA_CACHE_MS = 30_000; // 30-second freshness window

async function getPageData(tabId) {
  try {
    // ── Fast path: if content already provided fresh data for this URL, skip injection ──
    // We attempt a lightweight ping first; if the content script is alive we
    // get data back immediately without injecting or waiting.
    let response = null;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE' });
    } catch (_pingErr) {
      // Content script not yet injected — fall through to injection below
    }

    if (response?.url) {
      // Content script is alive — check if cache is still fresh
      const cached = _pageDataCache[response.url];
      if (cached && (Date.now() - cached.ts) < PAGE_DATA_CACHE_MS) {
        console.log('[PATHPILOT] Cache hit — skipping re-injection for', response.url);
        return cached.data;
      }
      // Cache stale or missing — store fresh result immediately (no re-injection needed)
      _pageDataCache[response.url] = { data: response, ts: Date.now() };
      console.log('[PATHPILOT] GOT PAGE (live):', response);
      return response;
    }

    // ── Slow path: inject content script then request data (no artificial delay) ──
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });

    // Give the script one microtask tick to register its message listener
    // (replaces the wasteful 300ms hard delay — same reliability, zero cost)
    await new Promise(r => setTimeout(r, 0));

    response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE' });
    console.log('[PATHPILOT] GOT PAGE (injected):', response);

    if (response?.url) {
      _pageDataCache[response.url] = { data: response, ts: Date.now() };
    }

    return response;
  } catch (err) {
    console.error('[PATHPILOT] SCRIPT NOT READY:', err);
    return null;
  }
}

async function performScan(targetTab = null) {
  if (!state.isMonitoring) return; // only run when user has started a session
  try {
    let tab = targetTab;
    if (!tab) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    }

    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    // Add to history
    if (state.urlHistory[state.urlHistory.length - 1] !== tab.url) {
      state.urlHistory.push(tab.url);
      if (state.urlHistory.length > 10) state.urlHistory.shift();
    }

    const page = await getPageData(tab.id);
    if (!page) return;

    await analyzePageData(page, tab.id);
  } catch (error) {
    console.error('[PATHPILOT] Scan error:', error);
  }
}

async function analyzePageData(pageData, tabId) {
  // ── Cooldown gate — max 1 call per URL per 60s ──────────────────────────────
  if (!canRunAnalysis(pageData.url)) return;

  // Capture goal version at call time — used to discard stale responses
  const requestGoalVersion = goalVersion;

  // STEP 9 — Instant "Analyzing..." so UI never waits blank for backend
  chrome.runtime.sendMessage({
    type: 'AI_RESULT',
    data: {
      score: 50, status: 'warning', level: 'warning',
      message: 'Analyzing...', action: 'wait',
      category: 'pending', suggestions: [], reason: '',
      modelUsed: 'pending', latency: 0, fallback: false,
      pageTitle: pageData.title,
    }
  }).catch(() => {});

  // STEP 6 — Cancel any in-flight analysis request before starting a new one
  if (_analyzeController) _analyzeController.abort();
  _analyzeController = new AbortController();
  const signal = _analyzeController.signal;

  try {
    console.log('[PATHPILOT] RECEIVED PAGE DATA — calling backend for:', pageData.url);

    const effectiveKey  = getEffectiveKey();
    const effectiveGoal = getEffectiveGoal(); // always reads currentGoal

    // STEP 5 — fetchWithTimeout (5s hard cap) prevents UI freeze
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/analyze`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type':   'application/json',
        'x-sentinel-key': effectiveKey
      },
      body: JSON.stringify({
        url:              pageData.url,
        pageTitle:        pageData.title,
        userGoal:         effectiveGoal,
        strictMode:       state.strictMode,
        history:          state.urlHistory.slice(-3),
        // ── Intent signals from content.js ──────────────────────────────────
        pageType:         pageData.pageType         || 'unknown',
        inputKeywords:    pageData.inputKeywords     || [],
        hasTypingActivity: pageData.hasTypingActivity || false,
        timeOnPage:       pageData.timeOnPage        || 0,
      })
    }, 5000);

    // ── Non-ok response guard (should not happen — analyze.js now returns 200 always) ──
    if (!res.ok) {
      const errText = await res.text();
      console.error('[PATHPILOT] Backend non-ok response:', res.status, errText);
      emitFallbackResult(pageData.url, pageData.title);
      return;
    }

    const analysis = await res.json();

    // ── Stale-response guard ──────────────────────────────────────────────────
    // If the user changed goal while this request was in-flight, discard result.
    if (requestGoalVersion !== goalVersion) {
      console.log(`[PATHPILOT] ⚡ Discarding stale response (goal changed during request). Expected v${requestGoalVersion}, current v${goalVersion}.`);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log('[PATHPILOT] BACKEND RESULT:', analysis.score, analysis.status, analysis.message);
    console.log('[DISCIPLINE MODE]', state.strictMode);

    // ── Defensive score guard ─────────────────────────────────────────────────
    if (typeof analysis.score !== 'number') analysis.score = 50;
    state.currentPageScore = analysis.score;

    const status = (analysis.status || 'warning').toLowerCase();

    // Map: aligned → focus, warning/off-track → waste
    if (status === 'aligned') {
      state.currentMode = 'focus';
      if (state.distractionStartTime !== null) {
        state.distractionStartTime = null;
        state.warningShown = false;
        saveState();
      }
    } else if (status === 'warning' || status === 'off-track') {
      state.currentMode = 'waste';
    }

    if (status === 'off-track') {
      state.distractionCount++;
    }

    if (state.strictMode === true) {
      if (status === 'aligned') {
        state.lastSafeUrl = pageData.url;
        chrome.storage.local.set({ lastSafeUrl: pageData.url });
        sendToTab(tabId, { type: 'CLEAR_WARNING' });
      } else if (status === 'warning') {
        sendToTab(tabId, { type: 'SHOW_BORDER', level: 'medium' });
      } else if (status === 'off-track') {
        sendToTab(tabId, { type: 'SHOW_BORDER', level: 'high' });
        setTimeout(() => {
          if (state.lastSafeUrl) {
            chrome.tabs.update(tabId, { url: state.lastSafeUrl });
          }
        }, 1200);
      }
    } else {
      // STRICT MODE = OFF
      if (status === 'aligned') {
        sendToTab(tabId, { type: 'CLEAR_WARNING' });
      } else if (status === 'warning') {
        sendToTab(tabId, { type: 'SHOW_BORDER', level: 'medium' });
      } else if (status === 'off-track') {
        sendToTab(tabId, { type: 'SHOW_BORDER', level: 'high' });
      }
    }

    // Log memory
    state.memoryLog.push({ url: pageData.url, score: analysis.score, timestamp: Date.now() });
    if (state.memoryLog.length > 100) state.memoryLog.shift();

    saveState();

    // Send AI_RESULT to sidepanel (includes pageTitle for display)
    const resultPayload = { ...analysis, pageTitle: pageData.title };
    chrome.runtime.sendMessage({ type: 'AI_RESULT', data: resultPayload }).catch(() => { });

  } catch (error) {
    // ── NETWORK / RUNTIME FAILURE — emit fallback so UI never goes empty ──────
    console.error('[PATHPILOT] analyzePageData error — emitting fallback to sidepanel:', error.message);
    emitFallbackResult(pageData.url, pageData.title);
  }
}

async function playVoice(text) {
  chrome.runtime.sendMessage({ type: 'PLAY_VOICE_CMD', text }).catch(() => { });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STATE') {
    // Always surface the SSOT goal in GET_STATE responses
    state.userGoal = currentGoal || state.userGoal;
    sendResponse(state);
  } else if (request.type === 'SET_GOAL') {
    // ── Apply goal via canonical routine (SSOT + version + fresh scan) ───────
    applyNewGoal(request.goal);
    state.currentTaskURL = request.taskURL || '';
    state.isMonitoring = true;
    state.sessionStart = Date.now();
    state.focusTime = 0;
    state.wastedTime = 0;
    state.distractionCount = 0;
    state.distractionStartTime = null;
    state.warningShown = false;
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'SET_STRICT_MODE') {
    const value = request.value !== undefined ? request.value : request.strictMode;
    state.strictMode = value;
    chrome.storage.local.set({ strictMode: value });
    saveState();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0] ? tabs[0].id : null;
      enforceStrictMode(activeTabId, value);
    });

    sendResponse({ success: true });
  } else if (request.type === 'SET_SECRET') {
    state.secretKey = request.secret;
    chrome.storage.local.set({ SENTINEL_SECRET: request.secret });
    sendResponse({ success: true });
  } else if (request.type === 'ADD_TASK') {
    state.taskList.push({ id: Date.now(), text: request.text, done: false });
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'COMPLETE_TASK') {
    const task = state.taskList.find(t => t.id === request.id);
    if (task) task.done = request.done;
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'STOP_MONITORING') {
    state.isMonitoring = false;
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'START_DISTRACTION_TIMER') {
    if (state.distractionStartTime === null) {
      state.distractionStartTime = request.time;
      state.warningShown = true;
      saveState();
    }
    sendResponse({ success: true });
  } else if (request.type === 'RESET_TIMER') {
    state.distractionStartTime = null;
    state.warningShown = false;
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'UPDATE_PAGE_TYPE') {
    state.currentMode = request.pageType;
    sendResponse({ success: true });
  } else if (request.type === 'RESET_SESSION') {
    state.focusTime = 0;
    state.wastedTime = 0;
    state.sessionStart = Date.now();
    state.distractionCount = 0;
    state.distractionStartTime = null;
    state.warningShown = false;
    state.currentMode = 'neutral';
    saveState();
    sendResponse({ success: true });
  } else if (request.type === 'DELETE_TASK') {
    state.taskList = state.taskList.filter(t => t.id !== request.id);
    saveState();
    sendResponse(state); // return full state so popup can sync
  }
  return true;
});
