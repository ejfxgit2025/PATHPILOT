const BACKEND_URL = 'http://localhost:3001';
const SECRET = 'sentinel-123'; // PathPilot auth key

// ── STEP 5 (sidepanel) — fetchWithTimeout: never freeze UI waiting for backend ─
// Uses AbortController internally; caller just gets a regular promise.
function _fetchWithTimeout(url, options, timeout = 4000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── FAIL-PROOF DATA LAYER ────────────────────────────────────────────────────
// Three functions that form the safety contract for the entire UI.
// NOTHING that reaches the DOM should bypass normalizeResult().

/**
 * fallbackResult() — canonical never-empty analysis object.
 * Used when backend is offline, network fails, or AI returns bad data.
 */
function fallbackResult() {
  return {
    score:     50,
    status:    'warning',
    level:     'warning',
    message:   'System offline — baseline analysis active.',
    action:    'warn',
    category:  'unknown',
    suggestions: [],
    reason:    'PathPilot is operating in offline fallback mode.',
    modelUsed: 'offline-fallback',
    latency:   0,
    fallback:  true,
  };
}

/**
 * normalizeResult(data) — ensures every field is the correct type.
 * Safe to call with undefined / null / partial object.
 */
function normalizeResult(data) {
  if (!data || typeof data !== 'object') return fallbackResult();
  const validStatuses = ['aligned', 'warning', 'off-track'];
  return {
    score:       typeof data.score === 'number' ? Math.max(0, Math.min(100, Math.round(data.score))) : 50,
    status:      validStatuses.includes(data.status) ? data.status : 'warning',
    level:       data.level    || 'warning',
    message:     (typeof data.message === 'string' && data.message.trim()) ? data.message : 'Baseline analysis active.',
    action:      data.action   || 'warn',
    category:    data.category || 'unknown',
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    reason:      data.reason   || '',
    modelUsed:   data.modelUsed || 'unknown',
    latency:     typeof data.latency === 'number' ? data.latency : 0,
    fallback:    data.fallback === true,
    pageTitle:   data.pageTitle || '',
  };
}

/**
 * defaultUIState() — safe state object for updateUI() on first load
 * before chrome.runtime.sendMessage returns.
 */
function defaultUIState() {
  return {
    userGoal:         'No Directive Set — Use Popup',
    focusTime:        0,
    wastedTime:       0,
    focusScore:       null,
    currentPageScore: 50,
    strictMode:       false,
    isMonitoring:     false,
    taskList:         [],
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Hybrid Voice State ─────────────────────────────────────────────────────
// ElevenLabs (primary) → Browser TTS (fallback)
let _elevenLabsAvailable = null; // null = unknown, true/false after check
let _voiceCheckPending   = false;

// DOM Elements
const goalDisplay = document.getElementById('goal-display');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusCard = document.getElementById('status-card');
const scoreRingProgress = document.getElementById('score-ring-progress');
const scoreValue = document.getElementById('score-value');
const statusLabel = document.getElementById('status-label');
const pageTitle = document.getElementById('page-title');
const aiMessage = document.getElementById('ai-message');
const focusTimeEl = document.getElementById('focus-time');
const wastedTimeEl = document.getElementById('wasted-time');
const taskListEl = document.getElementById('task-list');
const suggestionText = document.getElementById('suggestion-text');
const strictModeBtn = document.getElementById('strict-mode-btn');
const speakBtn = document.getElementById('speak-btn');
const voiceWave = document.getElementById('voice-wave');
const micBtn = document.getElementById('mic-btn');
const addTaskBtn = document.getElementById('add-task-btn');

// Modal Elements
const sessionModal = document.getElementById('session-modal');
const modalTotalTime = document.getElementById('modal-total-time');
const modalFocusTime = document.getElementById('modal-focus-time');
const modalWastedTime = document.getElementById('modal-wasted-time');
const modalDistractions = document.getElementById('modal-distractions');
const newSessionBtn = document.getElementById('new-session-btn');

// Microphone is initialized lazily — ONLY when the user clicks the mic button.
// Avoids "NotFoundError" on machines with no mic and prevents console spam.

// ── SMOOTH PROGRESS ANIMATION SYSTEM ────────────────────────────────────────
// Uses requestAnimationFrame + exponential easing for premium feel.
// Never jumps, never freezes — always interpolating.

let _progressCurrent   = 0;     // live animated value
let _progressTarget    = 0;     // where we're heading
let _progressRafId     = null;  // active RAF handle
let _progressDone      = false; // true once finishProgress() completes
let _progressFailsafe  = null;  // failsafe timer handle

/**
 * updateCircle(value)
 * Syncs the existing #score-value text, #score-ring-progress stroke,
 * and dynamic color class. No layout changes — only the number & ring fill.
 */
function updateCircle(value) {
  const v = Math.max(0, Math.min(100, value));

  // Update text
  scoreValue.textContent = Math.round(v);

  // Update SVG ring (stroke-dasharray = 283 = full circumference)
  const offset = 283 - (v / 100 * 283);
  scoreRingProgress.style.strokeDashoffset = offset;

  // Color logic: 0-40 red | 40-70 gold/yellow | 70-100 green
  scoreValue.classList.remove('progress-color-red', 'progress-color-yellow', 'progress-color-green');
  if (v < 40) {
    scoreValue.classList.add('progress-color-red');
    scoreRingProgress.style.stroke = 'var(--danger)';
  } else if (v < 70) {
    scoreValue.classList.add('progress-color-yellow');
    scoreRingProgress.style.stroke = 'var(--gold)';
  } else {
    scoreValue.classList.add('progress-color-green');
    scoreRingProgress.style.stroke = 'var(--success)';
  }
}

/** Internal RAF loop — runs until _progressDone is set externally */
function _progressTick() {
  // Exponential easing: lerp toward target by 8% per frame
  _progressCurrent += (_progressTarget - _progressCurrent) * 0.08;

  updateCircle(_progressCurrent);

  // Continue as long as we haven't snapped close enough AND not done
  if (!_progressDone && Math.abs(_progressCurrent - _progressTarget) > 0.15) {
    _progressRafId = requestAnimationFrame(_progressTick);
  } else if (!_progressDone) {
    // Reached target — stay put, loop finished
    _progressCurrent = _progressTarget;
    updateCircle(_progressCurrent);
    _progressRafId = null;
  }
}

/** Start the RAF loop toward a new target */
function _animateTo(target) {
  _progressTarget = Math.max(0, Math.min(100, target));
  if (_progressRafId) cancelAnimationFrame(_progressRafId);
  _progressRafId = requestAnimationFrame(_progressTick);
}

/**
 * startProgress()
 * Called on page load. Instantly starts 0 → 60 in ~600ms.
 * Never waits for backend. Adds pulse/glow classes.
 */
function startProgress() {
  _progressDone    = false;
  _progressCurrent = 0;
  _progressTarget  = 0;

  // Add animating pulse to ring + value
  scoreRingProgress.classList.add('progress-animating');
  scoreValue.classList.add('progress-animating');

  // Reset stroke override so CSS data-status rules can win later
  scoreRingProgress.style.stroke = '';

  // Remove old transition so RAF drives it smoothly
  scoreRingProgress.style.transition = 'none';

  updateCircle(0);

  // Animate 0 → 60 (perceived instant load)
  _animateTo(60);

  // Failsafe: if backend never responds, drift toward 50 after 8s
  if (_progressFailsafe) clearTimeout(_progressFailsafe);
  _progressFailsafe = setTimeout(() => {
    if (!_progressDone) {
      console.log('[PATHPILOT] Progress failsafe — drifting to 50');
      _animateTo(50);
    }
  }, 8000);
}

/**
 * finishProgress(score)
 * Called when backend result arrives. Animates current → real score,
 * then cleans up pulse effects. Duration ~300ms feel.
 * @param {number} score  0-100
 */
function finishProgress(score) {
  const target = Math.max(0, Math.min(100, Math.round(score)));

  // Cancel failsafe — backend responded
  if (_progressFailsafe) {
    clearTimeout(_progressFailsafe);
    _progressFailsafe = null;
  }

  // Mark done so the loop knows to stop after this target
  // We'll unmark after settling
  _progressDone = false;

  // Speed boost for finish: higher easing factor = faster feel
  // Override the default 0.08 by just animating normally —
  // the 300ms feel comes from the small delta remaining
  _animateTo(target);

  // After ~350ms the value will have settled — clean up pulse
  setTimeout(() => {
    _progressDone = true;
    if (_progressRafId) {
      cancelAnimationFrame(_progressRafId);
      _progressRafId = null;
    }
    // Snap to exact final value
    _progressCurrent = target;
    updateCircle(target);

    // Remove animating glow
    scoreRingProgress.classList.remove('progress-animating');
    scoreValue.classList.remove('progress-animating');

    // Restore CSS transition for future status-card color changes
    scoreRingProgress.style.transition = '';

    console.log(`[PATHPILOT] Progress settled at ${target}`);
  }, 380);
}

// ─────────────────────────────────────────────────────────────────────────────


function updateUI(state) {
  // ── NEVER render null state ── use safe defaults instead
  if (!state || typeof state !== 'object') state = defaultUIState();

  goalDisplay.textContent = state.userGoal || 'No Directive Set — Use Popup';

  // Focus score = focusTime / (focusTime + wastedTime) × 100
  // focusScore may be pre-computed by background, or we compute it here
  const totalTime = state.focusTime + state.wastedTime;
  let focusPercent;
  if (typeof state.focusScore === 'number') {
    focusPercent = state.focusScore;
  } else if (totalTime > 0) {
    focusPercent = Math.round((state.focusTime / totalTime) * 100);
  } else {
    focusPercent = null; // no data yet
  }

  progressBar.style.width = `${focusPercent ?? 0}%`;
  progressText.textContent = focusPercent !== null ? `${focusPercent}% FUTURE SCORE` : '—% FUTURE SCORE';

  const focusScoreDisplay = document.getElementById('focus-score-display');
  if (focusScoreDisplay) {
    focusScoreDisplay.textContent = focusPercent !== null ? `${focusPercent}%` : '—';
  }

  // Update Score Ring — initial state only; live updates go through finishProgress()
  // Only set if we haven't already started the animation system
  const score = state.currentPageScore;
  if (_progressDone) {
    // Animation already settled — update directly to keep in sync
    updateCircle(score);
  }
  // (if animation is running, let it run; backend result will call finishProgress)

  // Update Time display (Xm Ys format)
  focusTimeEl.textContent = formatTime(state.focusTime);
  wastedTimeEl.textContent = formatTime(state.wastedTime);

  // Strict Mode
  strictModeBtn.textContent = `⚙️ DISCIPLINE: ${state.strictMode ? 'ON' : 'OFF'}`;
  if (state.strictMode) strictModeBtn.classList.add('active');
  else strictModeBtn.classList.remove('active');

  // Monitoring stopped banner
  if (state.isMonitoring === false) {
    statusLabel.textContent = 'STATUS: ⏸ PATH NAVIGATOR OFFLINE';
    statusLabel.style.color = '#64748b';
  }

  // Render Tasks
  renderTasks(state.taskList || []);
}

function formatTime(ms) {
  // To make the UI feel alive, let's show seconds if under an hour, or just keep it simple with h/m/s
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

function renderTasks(tasks) {
  taskListEl.innerHTML = '';
  if (!tasks || tasks.length === 0) {
    taskListEl.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:8px 0;">No critical moves defined yet.</div>';
    return;
  }
  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = `task-item ${task.done ? 'done' : ''}`;
    div.style.cssText = 'display:flex;align-items:center;gap:8px;';
    div.innerHTML = `
      <input type="checkbox" ${task.done ? 'checked' : ''} data-id="${task.id}">
      <span style="flex:1;">${task.text.replace(/</g,'&lt;')}</span>
      <button class="task-del-btn" data-id="${task.id}" style="background:none;border:none;color:#555;cursor:pointer;font-size:13px;padding:0 2px;" title="Delete">✕</button>
    `;
    taskListEl.appendChild(div);
  });

  taskListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = parseInt(e.target.getAttribute('data-id'));
      chrome.runtime.sendMessage({ type: 'COMPLETE_TASK', id, done: e.target.checked });
    });
  });

  taskListEl.querySelectorAll('.task-del-btn').forEach(btn => {
    btn.addEventListener('mouseenter', e => e.target.style.color = '#ff6b6b');
    btn.addEventListener('mouseleave', e => e.target.style.color = '#555');
    btn.addEventListener('click', e => {
      const id = parseInt(e.currentTarget.getAttribute('data-id'));
      chrome.runtime.sendMessage({ type: 'DELETE_TASK', id });
      // Remove locally for instant feedback
      e.currentTarget.closest('.task-item').remove();
    });
  });
}

// Listen for updates from background
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'STATE_UPDATED') {
    updateUI(request.state);
  } else if (request.type === 'STATS_UPDATE') {
    focusTimeEl.textContent = formatTime(request.focusTime);
    wastedTimeEl.textContent = formatTime(request.wastedTime);
    const totalTime = request.focusTime + request.wastedTime;
    let focusPercent;
    if (typeof request.score === 'number') {
      focusPercent = request.score;
    } else if (totalTime > 0) {
      focusPercent = Math.round((request.focusTime / totalTime) * 100);
    } else {
      focusPercent = null;
    }
    progressBar.style.width = `${focusPercent ?? 0}%`;
    progressText.textContent = focusPercent !== null ? `${focusPercent}% FUTURE SCORE` : '—% FUTURE SCORE';
    const focusScoreDisplay = document.getElementById('focus-score-display');
    if (focusScoreDisplay) {
        focusScoreDisplay.textContent = focusPercent !== null ? `${focusPercent}%` : '—';
    }
  } else if (request.type === 'ANALYSIS_RESULT') {
    handleAnalysis(request.analysis);
  } else if (request.type === 'AI_RESULT') {
    // Primary message type sent by background after each page analysis
    console.log('[PATHPILOT] UI UPDATED', request.data);
    handleAnalysis(request.data);
  } else if (request.type === 'PLAY_VOICE_CMD') {
    speakMessage(request.text);
  }
});

// ── INSTANT PROGRESS KICKOFF ──────────────────────────────────────────────────
// Fire BEFORE the async GET_STATE response so the ring animates from frame 1.
// Never waits for backend. Perceived load time: instant.
startProgress();

// Initial load
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
  updateUI(state);
  chrome.storage.local.get(['strictMode'], (res) => {
    if (typeof res.strictMode === 'boolean' && state) {
      state.strictMode = res.strictMode;
      updateUI(state);
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.strictMode) {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
       if (state) {
         state.strictMode = changes.strictMode.newValue;
         updateUI(state);
       }
    });
  }
});

// Handle new analysis
function handleAnalysis(rawAnalysis) {
  // ── ALWAYS normalize — never bail on missing/invalid analysis ─────────────
  // normalizeResult() guarantees every field exists before touching the DOM.
  const analysis = normalizeResult(rawAnalysis);

  statusCard.setAttribute('data-status', analysis.status);

  // ── Warning edge glow ──────────────────────────────────
  if (analysis.status === 'off-track' || analysis.status === 'enforce') {
    document.body.classList.add('warning-state');
  } else {
    document.body.classList.remove('warning-state');
  }

  let statusIcon = '⚪';
  const statusMap = {
    'aligned':   { icon: '✅', label: 'ON PATH' },
    'warning':   { icon: '⚠️', label: 'PATH RISK' },
    'off-track': { icon: '⛔', label: 'PATH DEVIATION' }
  };
  const mapped = statusMap[analysis.status] || { icon: '⚪', label: analysis.status.toUpperCase() };
  statusLabel.textContent = `STATUS: ${mapped.icon} ${mapped.label}`;

  // Typewriter effect reset
  aiMessage.classList.remove('typewriter');
  void aiMessage.offsetWidth; // trigger reflow
  aiMessage.textContent = analysis.message || '';
  aiMessage.classList.add('typewriter');

  // Update score ring — delegate to smooth animation system
  if (typeof analysis.score === 'number') {
    finishProgress(analysis.score);
  }

  // Update page title — prefer payload value (available instantly), fall back to tabs API
  if (analysis.pageTitle) {
    pageTitle.textContent = analysis.pageTitle;
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) pageTitle.textContent = tabs[0].title || tabs[0].url;
    });
  }
}

// ── Hybrid Voice System ──────────────────────────────────────────────────────
// Strategy: ElevenLabs (primary WOW factor) → Browser TTS (safe fallback)
// Rule:     Voice is ONLY for short cinematic lines — never full paragraphs.

/** Check ElevenLabs availability once on load — caches result */
async function checkVoiceStatus() {
  if (_voiceCheckPending || _elevenLabsAvailable !== null) return;
  _voiceCheckPending = true;
  try {
    const res = await fetch(`${BACKEND_URL}/api/voice/status`);
    if (res.ok) {
      const data = await res.json();
      _elevenLabsAvailable = data.available === true;
      console.log(`[PATHPILOT] Voice status: ElevenLabs=${_elevenLabsAvailable}`, data.charRemaining != null ? `| chars left: ${data.charRemaining}` : '');
    } else {
      _elevenLabsAvailable = false;
    }
  } catch {
    _elevenLabsAvailable = false;
  } finally {
    _voiceCheckPending = false;
  }
}

/** Browser TTS fallback — silent fail if not supported */
function browserSpeak(text, rate = 0.88, pitch = 0.95) {
  if (!text || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = rate;
  utt.pitch = pitch;
  utt.volume = 1;
  // Prefer a deeper voice for cinematic feel
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.toLowerCase().includes('google') ||
    v.name.toLowerCase().includes('daniel') ||
    v.name.toLowerCase().includes('male')
  );
  if (preferred) utt.voice = preferred;
  speechSynthesis.speak(utt);
  return utt;
}

/**
 * speakMessage — Hybrid ElevenLabs → Browser TTS
 * voiceContext: 'default' | 'warning' | 'simulation'
 * IMPORTANT: Use this only for short, cinematic lines — not long paragraphs.
 */
async function speakMessage(text, voiceContext = 'default') {
  if (!text) return;

  // If ElevenLabs known unavailable → go straight to browser TTS
  if (_elevenLabsAvailable === false) {
    console.log(`[PATHPILOT] 🗣️ Browser TTS (fallback): "${text.substring(0, 40)}..."`);
    voiceWave.classList.add('active');
    const utt = browserSpeak(text);
    if (utt) utt.onend = () => voiceWave.classList.remove('active');
    else voiceWave.classList.remove('active');
    return;
  }

  // Try ElevenLabs
  voiceWave.classList.add('active');
  try {
    const response = await fetch(`${BACKEND_URL}/api/voice`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-sentinel-key': SECRET,
      },
      body: JSON.stringify({ text, voiceContext }),
    });

    if (!response.ok) {
      // ElevenLabs failed — mark unavailable, use browser TTS
      const errData = await response.json().catch(() => ({}));
      console.warn(`[PATHPILOT] ElevenLabs failed (${response.status}) — switching to browser TTS. Reason: ${errData.message || 'unknown'}`);
      _elevenLabsAvailable = false;
      const utt = browserSpeak(text);
      if (utt) utt.onend = () => voiceWave.classList.remove('active');
      else voiceWave.classList.remove('active');
      return;
    }

    // ElevenLabs success
    _elevenLabsAvailable = true;
    const audioBlob = await response.blob();
    const audioUrl  = URL.createObjectURL(audioBlob);
    const audio     = new Audio(audioUrl);

    console.log(`[PATHPILOT] 🎙️ ElevenLabs [${voiceContext}]: "${text.substring(0, 40)}..."`);
    audio.onended = () => {
      voiceWave.classList.remove('active');
      URL.revokeObjectURL(audioUrl);
    };
    audio.play().catch(() => {
      console.warn('[PATHPILOT] Audio blocked — user interaction needed first. Falling back to browser TTS.');
      _elevenLabsAvailable = false;
      voiceWave.classList.remove('active');
      browserSpeak(text);
    });

  } catch (error) {
    console.error('[PATHPILOT] Voice error — using browser TTS:', error);
    _elevenLabsAvailable = false;
    voiceWave.classList.remove('active');
    const utt = browserSpeak(text);
    if (utt) utt.onend = () => voiceWave.classList.remove('active');
  }
}

/**
 * speakLineCinematic — plays ONE short cinematic line strategically.
 * Use ONLY for: future outcome, failure warning, critical realization.
 * Never for full paragraphs.
 */
function speakLineCinematic(line, voiceContext = 'simulation') {
  if (!line || line.trim().length === 0) return;
  // Hard cap — if line is too long, abort (we don't narrate paragraphs)
  if (line.length > 180) {
    console.warn('[PATHPILOT] Voice line too long — skipped to preserve cinematic impact');
    return;
  }
  speakMessage(line.trim(), voiceContext);
}


if (speakBtn) {
  speakBtn.addEventListener('click', () => {
    if (aiMessage && aiMessage.textContent) {
      // Warning voice: use the short AI message (already ≤15 words from backend)
      speakLineCinematic(aiMessage.textContent, 'warning');
    }
  });
}

// Run voice status check immediately on load
checkVoiceStatus();


// Suggestion System — page-context-aware Next Move
document.getElementById('get-suggestion-btn').addEventListener('click', async () => {
  suggestionText.textContent = 'Reading current page...';

  chrome.runtime.sendMessage({ type: 'GET_STATE' }, async (state) => {
    // Step 1 — get the active tab so we can query the content script
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs?.[0];

      // Step 2 — request page data from content script (with graceful fallback)
      let pageData = { url: tab?.url || '', title: tab?.title || '', h1: '', text: '' };
      try {
        if (tab?.id) {
          pageData = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE' }, (resp) => {
              // chrome.runtime.lastError means content script not injected yet — use fallback
              if (chrome.runtime.lastError || !resp) {
                resolve({ url: tab.url || '', title: tab.title || '', h1: '', text: '' });
              } else {
                resolve(resp);
              }
            });
          });
        }
      } catch (_) { /* keep fallback */ }

      suggestionText.textContent = 'Calculating next move...';

      // Step 3 — POST goal + real page context to backend (timeout-guarded)
      try {
        const response = await _fetchWithTimeout(`${BACKEND_URL}/api/suggest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sentinel-key': SECRET
          },
          body: JSON.stringify({
            goal: state?.userGoal || '',
            page: {
              url:   pageData.url   || '',
              title: pageData.title || '',
              h1:    pageData.h1    || '',
              text:  pageData.text  || ''
            }
          })
        }, 4000);
        const data = await response.json();

        // Step 4 — display next_action (with reason as subtitle, fallback safe)
        const action = data.next_action || data.nextStep || 'Stay focused on your goal.';
        const reason = data.reason      || data.motivation || '';
        suggestionText.innerHTML = `
          <strong>${action}</strong>${reason ? `<br><span style="opacity:0.7; font-size:0.75rem;">"${reason}"</span>` : ''}
        `;
      } catch (error) {
        suggestionText.textContent = 'Stay focused on your goal.';
      }
    });
  });
});

// Add Task
if (addTaskBtn) {
  addTaskBtn.addEventListener('click', () => {
    const text = prompt('Enter new task:');
    if (text) {
      chrome.runtime.sendMessage({ type: 'ADD_TASK', text });
    }
  });
}

// Strict Mode Toggle
if (strictModeBtn) {
  strictModeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      const newValue = !state.strictMode;
      chrome.storage.local.set({ strictMode: newValue });
      chrome.runtime.sendMessage({ type: 'SET_STRICT_MODE', value: newValue });
    });
  });
}

// Session End Logic
const logoEl = document.querySelector('.logo');
if (logoEl) {
  logoEl.addEventListener('dblclick', () => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      if (modalTotalTime) modalTotalTime.textContent = formatTime(state.focusTime + state.wastedTime);
      if (modalFocusTime) modalFocusTime.textContent = formatTime(state.focusTime);
      if (modalWastedTime) modalWastedTime.textContent = formatTime(state.wastedTime);
      if (modalDistractions) modalDistractions.textContent = state.distractionCount;
      if (sessionModal) sessionModal.style.display = 'flex';
    });
  });
}

if (newSessionBtn) {
  newSessionBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, () => {
      if (sessionModal) sessionModal.style.display = 'none';
    });
  });
}

// ── Mic System (Web Speech API) — lazy init —————————————————————————
// recognition is created ONLY on first mic-button click.
// A guard flag prevents repeated permission prompts if the user clicks again.
let _recognition      = null;
let _micInitialized   = false;  // true once successfully started
let _micInitFailed    = false;  // true if getUserMedia failed — stops retries

async function initMic() {
  // Already running or permanently failed — nothing to do
  if (_micInitialized || _micInitFailed) return;

  // Check API availability first (no mic on this device / browser)
  if (!navigator.mediaDevices?.getUserMedia) {
    _micInitFailed = true;
    return;
  }

  try {
    // Request permission — only fires the OS dialog, no audio is recorded here
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    // NotFoundError  = no mic hardware
    // NotAllowedError = user denied permission
    // Either way: mark as failed so we never prompt again
    _micInitFailed = true;
    if (err.name !== 'NotFoundError' && err.name !== 'NotAllowedError') {
      // Log unexpected errors only (not the two expected cases)
      console.warn('[PATHPILOT] Mic unavailable:', err.name);
    }
    return;
  }

  // Build recognition object lazily (avoids crash when API is missing)
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) {
    _micInitFailed = true;
    return;
  }

  _recognition = new SpeechRecognitionAPI();
  _recognition.lang       = 'en-US';
  _recognition.continuous = false;

  _recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    const goalInput = document.getElementById('goal-input');
    if (goalInput) {
      goalInput.value = text;
    } else {
      chrome.runtime.sendMessage({ type: 'SET_GOAL', goal: text }, () => {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => updateUI(state));
      });
    }
  };

  _recognition.onerror = (e) => {
    // Only log non-trivial errors (no-speech is expected and noisy)
    if (e.error !== 'no-speech') {
      console.warn('[PATHPILOT] Speech recognition error:', e.error);
    }
  };

  _micInitialized = true;
  _recognition.start();
}

if (micBtn) {
  micBtn.addEventListener('click', initMic);
}


// ── KIMI FUTURE SIMULATION SYSTEM ─── Cinematic Experience ──────────────────

const simulateBtn     = document.getElementById('simulate-btn');
const simulateResults = document.getElementById('simulate-results');
const simOverlay      = document.getElementById('sim-overlay');
const simPhaseList    = document.getElementById('sim-phase-list');
const simVoiceReplay  = document.getElementById('sim-voice-replay');
const simVoiceReplayBtn = document.getElementById('sim-voice-replay-btn');

// Phases shown inside overlay (each appears with a delay)
const SIM_PHASES = [
  'Scanning current behavior...',
  'Mapping possible futures...',
  'Calculating risk probabilities...',
  'Projecting 2027 outcome...',
];

/** Show cinematic overlay, sequentially add phase lines, return a cleanup fn */
function showSimOverlay() {
  simOverlay.style.display = 'flex';
  simOverlay.classList.remove('closing');
  simPhaseList.innerHTML = '';
  simOverlay.querySelector('#sim-overlay-headline').textContent = 'Analyzing your future...';

  const timers = [];
  SIM_PHASES.forEach((phase, i) => {
    const t = setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'sim-phase-item active';
      el.innerHTML = `<span class="phase-dot"></span>${phase}`;
      simPhaseList.appendChild(el);
      // Dim previous
      const items = simPhaseList.querySelectorAll('.sim-phase-item');
      items.forEach((item, idx) => {
        if (idx < items.length - 1) item.classList.remove('active');
      });
    }, i * 950);
    timers.push(t);
  });

  return () => timers.forEach(clearTimeout);
}

/** Flash-dismiss the overlay with a closing animation */
function hideSimOverlay(cb) {
  simOverlay.classList.add('closing');
  setTimeout(() => {
    simOverlay.style.display = 'none';
    simOverlay.classList.remove('closing');
    if (cb) cb();
  }, 400);
}

/** Animate score counter from 0 → target */
function animateScoreCounter(target, durationMs = 900) {
  const el = scoreValue;
  if (!el || typeof target !== 'number') return;
  const start = performance.now();
  const startVal = 0;
  el.classList.add('counting');

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / durationMs, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(startVal + (target - startVal) * eased);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = target;
      el.classList.remove('counting');
    }
  }
  requestAnimationFrame(tick);
}

/** HTML-escape helper */
const esc = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Map path name → CSS class */
function pathClass(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('safe'))       return 'safe';
  if (n.includes('growth'))     return 'growth';
  if (n.includes('risk'))       return 'risk-path';
  if (n.includes('aggressive')) return 'aggressive';
  if (n.includes('alt'))        return 'alternative';
  return 'safe';
}

/** Build a single staggered path card with timeline entries */
function buildPathCard(path) {
  const cls = pathClass(path.name);
  const chips = [
    path.timeToSuccess && `⏱ ${esc(path.timeToSuccess)}`,
    path.risk          && `Risk: ${esc(path.risk)}`,
    path.failureChance && `Fail: ${esc(path.failureChance)}`,
    path.burnoutRisk   && `Burnout: ${esc(path.burnoutRisk)}`,
  ].filter(Boolean).map(c => `<span class="sim-path-meta-chip">${c}</span>`).join('');

  const income = path.income
    ? `<div class="sim-path-income">${esc(path.income)}</div>` : '';

  // Build timeline section if new-schema fields exist
  const hasTimeline = path.sixMonths || path.twelveMonths || path.twoYears;
  const timelineHtml = hasTimeline ? `
    <div class="sim-path-timeline">
      ${path.sixMonths    ? `<div class="sim-tl-entry"><span class="sim-tl-label">6M</span><span class="sim-tl-text">${esc(path.sixMonths)}</span></div>` : ''}
      ${path.twelveMonths ? `<div class="sim-tl-entry"><span class="sim-tl-label">12M</span><span class="sim-tl-text">${esc(path.twelveMonths)}</span></div>` : ''}
      ${path.twoYears     ? `<div class="sim-tl-entry"><span class="sim-tl-label">2Y</span><span class="sim-tl-text">${esc(path.twoYears)}</span></div>` : ''}
    </div>` : `<div class="sim-path-card-desc">${esc(path.description || path.outcome || '')}</div>`;

  return `
    <div class="sim-path-card ${cls}">
      <div class="sim-path-card-name">${esc(path.name)}</div>
      ${income}
      ${timelineHtml}
      <div class="sim-path-card-meta">${chips}</div>
    </div>`;
}

/**
 * Render all simulation results into #simulate-results.
 * Supports new adaptive identity schema + legacy flat fields.
 */
function renderSimulationResults(data) {
  let paths = [];
  if (Array.isArray(data.paths) && data.paths.length) {
    paths = data.paths;
  } else {
    paths = [
      { name: 'SAFE PATH',   description: data.safePathOutcome,    risk: 'Low',    timeToSuccess: '12-18 months' },
      { name: 'GROWTH PATH', description: data.founderPathOutcome, risk: 'Medium', timeToSuccess: '9-12 months'  },
      { name: 'RISK PATH',   description: data.agencyPathOutcome,  risk: 'High',   timeToSuccess: 'Never without change' },
    ];
  }

  // ── Identity Statement ──────────────────────────────────
  const alignmentClass = {
    aligned:   'identity-aligned',
    neutral:   'identity-neutral',
    misaligned:'identity-misaligned',
  }[data.behaviorAlignment || 'neutral'] || 'identity-neutral';

  const identityHtml = data.identityStatement ? `
    <div class="sim-identity-card ${alignmentClass}">
      <div class="sim-identity-label">Your Current Identity</div>
      <div class="sim-identity-text">${esc(data.identityStatement)}</div>
      ${data.behaviorNote ? `<div class="sim-behavior-note">${esc(data.behaviorNote)}</div>` : ''}
    </div>` : '';

  // ── 3 Path Cards ────────────────────────────────────────
  const pathsHtml = paths.map(buildPathCard).join('');

  // ── Critical Intelligence Grid ──────────────────────────
  const hasCritical = data.biggestRisk || data.criticalBlindSpot || data.leveragePoint || data.nextAction;
  const criticalHtml = hasCritical ? `
    <div class="sim-section-label">Critical Intelligence</div>
    <div class="sim-critical-grid">
      ${data.biggestRisk ? `
        <div class="sim-critical-item risk">
          <div class="sim-critical-item-label">⚠ Biggest Risk</div>
          <div class="sim-critical-item-text">${esc(data.biggestRisk)}</div>
        </div>` : ''}
      ${data.criticalBlindSpot ? `
        <div class="sim-critical-item blind">
          <div class="sim-critical-item-label">👁 Blind Spot</div>
          <div class="sim-critical-item-text">${esc(data.criticalBlindSpot)}</div>
        </div>` : ''}
      ${data.leveragePoint ? `
        <div class="sim-critical-item leverage">
          <div class="sim-critical-item-label">⚡ Leverage Point</div>
          <div class="sim-critical-item-text">${esc(data.leveragePoint)}</div>
        </div>` : ''}
      ${data.nextAction ? `
        <div class="sim-critical-item action">
          <div class="sim-critical-item-label">▶ Next Action</div>
          <div class="sim-critical-item-text">${esc(data.nextAction)}</div>
        </div>` : ''}
    </div>` : '';

  // ── Mentor Card ─────────────────────────────────────────
  const mentorHtml = data.mentorAdvice ? `
    <div class="sim-section-label">Mentor Signal</div>
    <div class="sim-mentor-card">
      <div class="sim-mentor-label">Top Mentor Says</div>
      "${esc(data.mentorAdvice)}"
    </div>` : '';

  // ── Cinematic Voice Lines Strip ──────────────────────────
  // STRATEGIC: show 2-3 short cinematic lines with individual play buttons.
  // Each line is a standalone emotional punch — not a narrated paragraph.
  const voiceLines = Array.isArray(data.voiceLines) && data.voiceLines.length
    ? data.voiceLines.filter(l => l && l.trim())
    : [];

  const voiceLinesHtml = voiceLines.length ? `
    <div class="sim-section-label">🎙 Voice Lines</div>
    <div class="sim-voice-lines-strip" id="sim-voice-lines-strip">
      ${voiceLines.map((line, i) => `
        <div class="sim-voice-line" data-line-index="${i}">
          <span class="sim-voice-line-text">${esc(line)}</span>
          <button class="sim-voice-line-btn" data-line="${esc(line)}" title="Play this line">🔊</button>
        </div>
      `).join('')}
    </div>` : '';

  const modelLabel = data.fallback
    ? `<span class="sim-fallback-badge">Offline Mode</span>`
    : esc((data.modelUsed || 'AI').toUpperCase());

  simulateResults.innerHTML = `
    ${identityHtml}
    <div class="sim-section-label">3-Path Future Simulation</div>
    <div id="sim-paths-container">${pathsHtml}</div>
    ${criticalHtml}
    ${voiceLinesHtml}
    ${mentorHtml}
    <div class="sim-model-tag">Powered by ${modelLabel} · ${data.latency ? Math.round(data.latency / 1000) + 's' : '—'}</div>
  `;

  // Wire up individual voice line play buttons (event delegation)
  const strip = document.getElementById('sim-voice-lines-strip');
  if (strip) {
    strip.addEventListener('click', (e) => {
      const btn = e.target.closest('.sim-voice-line-btn');
      if (!btn) return;
      const line = btn.getAttribute('data-line');
      if (line) {
        // Highlight active line
        strip.querySelectorAll('.sim-voice-line').forEach(el => el.classList.remove('playing'));
        btn.closest('.sim-voice-line').classList.add('playing');
        speakLineCinematic(line, 'simulation');
        // Remove highlight after ~4s
        setTimeout(() => btn.closest('.sim-voice-line')?.classList.remove('playing'), 4000);
      }
    });
  }

  simulateResults.style.animation = 'none';
  void simulateResults.offsetWidth;
  simulateResults.style.animation = '';

  // Return voiceLines for the caller to use for auto-play
  return voiceLines;
}

// Track voice lines for replay
let _lastVoiceLines = [];

if (simulateBtn) {
  simulateBtn.addEventListener('click', () => {
    simulateBtn.disabled = true;
    simulateBtn.classList.add('running');
    simulateResults.style.display = 'none';
    simVoiceReplay.style.display = 'none';
    _lastVoiceLines = [];

    // Step 1 — show cinematic overlay
    const cancelPhases = showSimOverlay();

    chrome.runtime.sendMessage({ type: 'GET_STATE' }, async (state) => {
      try {
        const response = await _fetchWithTimeout(`${BACKEND_URL}/api/simulate`, {
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'x-sentinel-key': SECRET,
          },
          body: JSON.stringify({
            goal:        state?.userGoal   || 'become a successful founder',
            directive:   state?.userGoal   || 'become a successful founder',
            focusTime:   state?.focusTime  || 0,
            wastedTime:  state?.wastedTime || 0,
            sessionDays: 1,
          }),
        }, 8000);

        if (!response.ok) throw new Error('Simulation API error');
        const data = await response.json();

        // Cancel any remaining phase timers
        cancelPhases();

        // Step 3 — flash transition: close overlay → reveal results
        hideSimOverlay(() => {
          simulateResults.style.display = 'block';
          const voiceLines = renderSimulationResults(data);

          // Animate score from 0 → focus score (if available)
          if (state?.focusScore != null) {
            animateScoreCounter(state.focusScore);
            const offset = 283 - (state.focusScore / 100 * 283);
            if (scoreRingProgress) {
              scoreRingProgress.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)';
              scoreRingProgress.style.strokeDashoffset = offset;
            }
          }

          // ── STRATEGIC VOICE MOMENT ────────────────────────────
          // Play ONLY the first cinematic line after a short pause.
          // Voice is used for impact, not narration — short + sharp = powerful.
          const lines = voiceLines && voiceLines.length ? voiceLines
            : (data.voiceNarration ? [data.voiceNarration] : []);

          if (lines.length > 0) {
            _lastVoiceLines = lines;
            // 800ms delay — let the UI reveal first, then hit them with the line
            setTimeout(() => speakLineCinematic(lines[0], 'simulation'), 800);
            simVoiceReplay.style.display = 'block';
          }
        });

      } catch (error) {
        cancelPhases();
        console.error('[PATHPILOT] Simulate error — showing fallback simulation:', error);

        // ── FALLBACK SIMULATION CARD — never show a blank error string ──────
        const fallbackSim = {
          fallback:          true,
          modelUsed:         'offline-fallback',
          latency:           0,
          identityStatement: 'The system is temporarily offline.',
          behaviorAlignment: 'neutral',
          behaviorNote:      'Your direction remains valid even when systems fail.',
          paths: [
            {
              name:         'SAFE PATH',
              description:  'Continue your current work. Small steps compound into results.',
              risk:         'Low',
              timeToSuccess: '12-18 months',
              sixMonths:    'Steady progress through consistent daily execution.',
              twelveMonths: 'Visible results from compounded effort.',
              twoYears:     'Established position in your chosen domain.',
            },
            {
              name:         'GROWTH PATH',
              description:  'Increase intensity. Ship faster. Get feedback sooner.',
              risk:         'Medium',
              timeToSuccess: '9-12 months',
              sixMonths:    'First users or revenue from accelerated effort.',
              twelveMonths: 'Product-market fit signals emerging.',
              twoYears:     'Scalable business with real traction.',
            },
            {
              name:         'RISK PATH',
              description:  'Distraction and inconsistency compound into stagnation.',
              risk:         'High',
              timeToSuccess: 'Never without change',
              sixMonths:    'Minimal progress. Motivation declining.',
              twelveMonths: 'Regret setting in. Opportunity cost visible.',
              twoYears:     'Watching others succeed while you stayed stuck.',
            },
          ],
          biggestRisk:       'Letting a system outage derail your momentum.',
          criticalBlindSpot: 'Systems fail. Builders keep building regardless.',
          leveragePoint:     'Your next focused 30 minutes.',
          nextAction:        'Close this panel and execute your most important task.',
          mentorAdvice:      'The system went down. You didn\'t. Keep moving.',
          voiceLines: [
            'The system failed — but your direction doesn\'t have to.',
            'Most people stop here. That\'s why they never grow.',
            'Keep moving. Consistency beats perfect systems.',
          ],
        };

        hideSimOverlay(() => {
          simulateResults.style.display = 'block';
          const voiceLines = renderSimulationResults(fallbackSim);
          if (voiceLines.length > 0) {
            _lastVoiceLines = voiceLines;
            setTimeout(() => speakLineCinematic(voiceLines[0], 'simulation'), 800);
            simVoiceReplay.style.display = 'block';
          }
        });
      } finally {
        simulateBtn.disabled = false;
        simulateBtn.classList.remove('running');
        simulateBtn.textContent = '⚡ SIMULATE MY FUTURE';
      }
    });
  });
}

// Voice replay button — cycles through all cinematic lines with a pause between each
if (simVoiceReplayBtn) {
  simVoiceReplayBtn.addEventListener('click', () => {
    if (!_lastVoiceLines.length) return;
    // Play each line sequentially with 700ms gap
    let i = 0;
    function playNext() {
      if (i >= _lastVoiceLines.length) return;
      speakLineCinematic(_lastVoiceLines[i], 'simulation');
      i++;
      // Estimate duration: ~120 chars/sec for TTS, min 1.5s between lines
      const lineDurationMs = Math.max(1500, _lastVoiceLines[i - 1].length * 60);
      if (i < _lastVoiceLines.length) setTimeout(playNext, lineDurationMs);
    }
    playNext();
  });
}


// ═══════════════════════════════════════════════════════════════════
// 🛡️  PROTECTION MODE — Scam Detection System
// ═══════════════════════════════════════════════════════════════════
//
// STATE MACHINE:
//   protectionMode = false (default OFF)
//
// FLOW ON PAGE LOAD (only when ON):
//   1. L0 rule check (FREE, backend)
//   2. If safe → stop, no AI
//   3. If suspicious/high_risk → call L1 Kimi (60 tokens max)
//   4. Return instantly after L1
//
// L3 Hermes → ONLY when user clicks "Why is this dangerous?"
//             NEVER auto-triggered
//
// UI INJECTION:
//   - Scam badge injected into #ai-message-container (Current Signal)
//   - Optional overlay for high_risk pages
//   - NEVER blocks or redesigns existing layout
// ═══════════════════════════════════════════════════════════════════

let protectionMode = false;
let _lastProtectUrl = '';   // dedupe — don't re-scan same URL

// ── DOM refs ────────────────────────────────────────────────────────
const protectToggleBtn    = document.getElementById('protect-toggle');
const protectStatusText   = document.getElementById('protect-status-text');
const protectOverlay      = document.getElementById('protect-overlay');
const protectOverlayTitle = document.getElementById('protect-overlay-title');
const protectOverlaySub   = document.getElementById('protect-overlay-sub');
const protectLeaveBtn     = document.getElementById('protect-leave-btn');
const protectIgnoreBtn    = document.getElementById('protect-ignore-btn');
const protectExplainBtn   = document.getElementById('protect-explain-btn');
const protectExplainResult= document.getElementById('protect-explain-result');

// ── Persist protection mode state across reloads ─────────────────────
chrome.storage.local.get(['protectionMode'], (res) => {
  if (typeof res.protectionMode === 'boolean') {
    protectionMode = res.protectionMode;
    _applyProtectUI();
    // Trigger scan AFTER state is confirmed from storage (not before)
    if (protectionMode) {
      _renderProtectPending();
      setTimeout(_scanCurrentTab, 600);
    }
  }
});

/** Sync toggle visual state to protectionMode value */
function _applyProtectUI() {
  if (!protectToggleBtn || !protectStatusText) return;
  if (protectionMode) {
    protectToggleBtn.classList.add('active');
    protectStatusText.textContent = 'ON';
  } else {
    protectToggleBtn.classList.remove('active');
    protectStatusText.textContent = 'OFF';
    _hideProtectOverlay();
    _clearSignalBadge();
  }
}

// ── Toggle listener ──────────────────────────────────────────────────
if (protectToggleBtn) {
  protectToggleBtn.addEventListener('click', () => {
    protectionMode = !protectionMode;
    chrome.storage.local.set({ protectionMode });
    _applyProtectUI();
    console.log(`[PROTECT] Mode toggled \u2192 ${protectionMode ? 'ON' : 'OFF'}`);

    if (protectionMode) {
      // Show pending state IMMEDIATELY — never leave ai-message blank
      _renderProtectPending();
      // Then kick off the actual scan (non-blocking)
      _scanCurrentTab();
    } else {
      // Protection OFF — clear any leftover protect UI
      _clearProtectRender();
      _hideProtectOverlay();
    }
  });
}

// ── Overlay: Leave Site ───────────────────────────────────────────────
if (protectLeaveBtn) {
  protectLeaveBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        // Navigate to blank safe page
        chrome.tabs.update(tabs[0].id, { url: 'about:blank' });
      }
    });
    _hideProtectOverlay();
  });
}

// ── Overlay: Ignore ───────────────────────────────────────────────────
if (protectIgnoreBtn) {
  protectIgnoreBtn.addEventListener('click', () => {
    _hideProtectOverlay();
  });
}

// ── "Why is this dangerous?" — triggers L3 Hermes (user-initiated only)
if (protectExplainBtn) {
  protectExplainBtn.addEventListener('click', async () => {
    if (!_lastProtectUrl) return;

    protectExplainBtn.textContent = 'Analyzing...';
    protectExplainBtn.disabled = true;
    protectExplainResult.style.display = 'none';

    try {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const url   = tabs[0]?.url   || _lastProtectUrl;
        const title = tabs[0]?.title || '';

        const resp = await fetch(`${BACKEND_URL}/api/protect/explain`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ url, title }),
        });

        if (!resp.ok) throw new Error('explain failed');
        const data = await resp.json();

        protectExplainResult.textContent = data.explanation || 'No explanation available.';
        protectExplainResult.style.display = 'block';
        protectExplainBtn.style.display = 'none'; // hide after first use
      });
    } catch (_) {
      protectExplainResult.textContent = 'Analysis unavailable — treat this site as high risk.';
      protectExplainResult.style.display = 'block';
    } finally {
      protectExplainBtn.disabled = false;
      protectExplainBtn.textContent = 'Why is this dangerous?';
    }
  });
}

// ── Show / Hide overlay ───────────────────────────────────────────────

function _showProtectOverlay(title, sub) {
  if (!protectOverlay) return;
  protectOverlayTitle.textContent = title || 'High Risk Detected';
  protectOverlaySub.textContent   = sub   || 'Possible wallet drain behavior';
  // Reset explain area
  if (protectExplainResult) {
    protectExplainResult.style.display = 'none';
    protectExplainResult.textContent   = '';
  }
  if (protectExplainBtn) {
    protectExplainBtn.style.display  = '';
    protectExplainBtn.disabled       = false;
    protectExplainBtn.textContent    = 'Why is this dangerous?';
  }
  protectOverlay.style.display = 'block';
}

function _hideProtectOverlay() {
  if (protectOverlay) protectOverlay.style.display = 'none';
}

// ── renderProtection() — writes result into existing #ai-message ──────
//
// RULES:
//   - Targets the EXISTING .ai-message element inside Current Signal
//   - Never creates new cards or sections
//   - Never leaves the element empty
//   - Independent from the normal analysis flow
//   - Called ONLY when Protection Mode is ON

/**
 * renderProtection(result)
 *
 * Maps backend risk level → plain-text line in the existing #ai-message.
 *
 * @param {{ risk?: string, reason?: string, status?: string } | null} result
 */
function renderProtection(result) {
  if (!aiMessage) return;

  // Normalise: backend returns either .risk (L1 schema) or .status (protect route)
  const risk = result?.risk || result?.status || null;

  let line1, line2;

  if (risk === 'safe') {
    line1 = '\u2705 Safe Site';
    line2 = 'No scam patterns detected';
  } else if (risk === 'suspicious') {
    line1 = '\u26a0\ufe0f Suspicious Signals';
    line2 = result?.reason || 'This page shows unusual patterns';
  } else if (risk === 'scam' || risk === 'high_risk') {
    line1 = '\ud83d\udea8 High Risk Detected';
    line2 = result?.reason || 'Possible wallet drain or scam attempt';
  } else {
    // Fallback — never leave empty
    line1 = 'Analyzing page safety...';
    line2 = '';
  }

  // Write into existing element — plain text, same font, same container
  aiMessage.classList.remove('typewriter');
  void aiMessage.offsetWidth; // force reflow to restart animation if needed
  aiMessage.textContent = line2 ? `${line1}\n${line2}` : line1;
  aiMessage.classList.add('typewriter');

  console.log(`[PROTECT] renderProtection → risk:${risk} | "${line1}"`);
}

/** Show the pending state immediately when Protection Mode is toggled ON. */
function _renderProtectPending() {
  if (!aiMessage) return;
  aiMessage.classList.remove('typewriter');
  void aiMessage.offsetWidth;
  aiMessage.textContent = 'Analyzing page safety...';
  aiMessage.classList.add('typewriter');
}

/** Restore the ai-message to normal analysis output (Protection Mode OFF). */
function _clearProtectRender() {
  // The next normal ANALYSIS_RESULT / AI_RESULT message will naturally
  // overwrite ai-message — no manual clear needed. Just remove the badge.
  _clearSignalBadge();
}

// ── Legacy badge helpers (kept for high-risk overlay wiring) ──────────

function _injectSignalBadge(message) {
  _clearSignalBadge();
  const container = document.querySelector('.ai-message-container');
  if (!container) return;
  const badge = document.createElement('div');
  badge.className = 'protect-signal-badge';
  badge.id        = 'protect-signal-badge';
  badge.textContent = message;
  container.parentNode.insertBefore(badge, container.nextSibling);
}

function _clearSignalBadge() {
  const existing = document.getElementById('protect-signal-badge');
  if (existing) existing.remove();
}

// ── Core scan function ────────────────────────────────────────────────

/**
 * Scan the active tab via the backend protection endpoint.
 * Respects the FLOW:
 *   Backend L0 → if safe: stop.
 *   Backend L1 → called automatically when L0 flags suspicious/high_risk.
 *   No L2, no L3 auto-trigger.
 *
 * Non-blocking: UI is NEVER held waiting for this.
 */
async function _scanCurrentTab() {
  if (!protectionMode) return;

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab   = tabs[0];
    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;

    // Dedupe — don't re-scan the same URL unnecessarily
    if (tab.url === _lastProtectUrl) return;
    _lastProtectUrl = tab.url;

    const url   = tab.url;
    const title = tab.title || '';

    console.log(`[PROTECT] Scanning: ${url}`);

    // FAILSAFE — if backend is unavailable, render fallback, never leave UI empty
    let data;
    try {
      // STEP 5 — timeout-guarded fetch prevents UI freeze on slow/unreachable backend
      const resp = await _fetchWithTimeout(`${BACKEND_URL}/api/protect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, title }),
      }, 4000);

      // Even if not .ok, use fallback — never let errors surface to UI
      data = resp.ok ? await resp.json() : { score: 50, status: 'fallback', message: 'Analyzing...' };
    } catch (_) {
      // Backend offline — render pending state so UI is never empty
      console.warn('[PROTECT] Backend unreachable — showing safe fallback');
      _renderProtectPending(); // keeps "Analyzing page safety..." visible
      return;
    }

    // ── React to result — route through renderProtection() ─────────────
    const status = data?.status || 'fallback';

    if (status === 'fallback') {
      // Inconclusive — keep the pending "Analyzing..." text, no overlay
      return;
    }

    // Map protect-route status → renderProtection risk vocabulary
    // Backend returns: safe | suspicious | high_risk | fallback
    // renderProtection understands: safe | suspicious | scam | high_risk | null
    renderProtection(data);

    if (status === 'safe') {
      _clearSignalBadge();
      _hideProtectOverlay();
      return;
    }

    if (status === 'suspicious') {
      // Badge supplements the ai-message text for added visibility
      _injectSignalBadge('\u26a0\ufe0f Suspicious: Exercise caution on this page');
      return;
    }

    if (status === 'scam' || status === 'high_risk') {
      // Badge + overlay for high severity (both L1 scam and L0 high_risk)
      _injectSignalBadge('\ud83d\udea8 High Risk: Possible scam or wallet drain attempt');
      _showProtectOverlay(
        'High Risk Detected',
        data.reason || 'Possible wallet drain behavior'
      );
    }
  });
}

// ── Auto-scan when tab changes (only if Protection Mode is ON) ──────────
chrome.tabs?.onActivated?.addListener(() => {
  if (protectionMode) {
    _lastProtectUrl = ''; // reset dedupe so new tab gets scanned
    setTimeout(_scanCurrentTab, 300); // small delay for tab to settle
  }
});

// Listen for tab URL updates (navigation within same tab)
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (!protectionMode) return;
  if (changeInfo.status === 'complete' && changeInfo.url) {
    _lastProtectUrl = ''; // reset dedupe on navigation
    setTimeout(_scanCurrentTab, 400);
  }
});

// ── NOTE: Initial scan on sidepanel open is handled inside the
// chrome.storage.local.get callback above, AFTER protectionMode state
// is confirmed from persistent storage. Do NOT scan here — protectionMode
// may still be false at this point due to async storage read.
