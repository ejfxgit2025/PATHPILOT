// ============================================================
//  PATHPILOT POPUP — Future Decision Sidecar
// ============================================================

let state = {
  currentTask: '',
  tasks: [],
  isRunning: false,
  isMonitoring: false,
  distractionCount: 0,
  strictMode: false
};

// ── Mic System (Web Speech API) — lazy init —————————————————————————
// getUserMedia is called ONLY when the user clicks the mic button.
// Guard flags prevent repeated prompts and console spam.
let _recognition    = null;
let _micInitialized = false;  // true once successfully started
let _micInitFailed  = false;  // true if mic is unavailable — stops retries

async function initMic() {
  if (_micInitialized || _micInitFailed) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    _micInitFailed = true;
    return;
  }

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    _micInitFailed = true;
    // Silence expected cases (no mic / permission denied) — only log surprises
    if (err.name !== 'NotFoundError' && err.name !== 'NotAllowedError') {
      console.warn('[PATHPILOT] Mic unavailable:', err.name);
    }
    return;
  }

  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) { _micInitFailed = true; return; }

  _recognition = new SpeechRecognitionAPI();
  _recognition.lang       = 'en-US';
  _recognition.continuous = false;

  _recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    const goalInput = document.getElementById('goal-input');
    if (goalInput) {
      goalInput.value = text;
      state.currentTask = text;
      render();
    }
  };

  _recognition.onerror = (e) => {
    if (e.error !== 'no-speech') {
      console.warn('[PATHPILOT] Speech recognition error:', e.error);
    }
  };

  _micInitialized = true;
  _recognition.start();
}

// ── DOM refs ──────────────────────────────────────────────
const goalInput = document.getElementById('goal-input');
const toggleSwitch = document.getElementById('toggle-switch');
const activateBtn = document.getElementById('activate-btn');
const openPanelBtn = document.getElementById('open-panel');
const missionFeedback = document.getElementById('mission-feedback');
const statusDot = document.querySelector('.live-dot');
const statusText = document.querySelector('.status-text');
const statusIndicator = document.querySelector('.status-indicator');
const taskInput = document.getElementById('task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const popupTaskList = document.getElementById('popup-task-list');
const distractCount = document.getElementById('distraction-count');

// ── Render (single source of truth → DOM) ─────────────────
function render() {
  // Goal input
  goalInput.value = state.currentTask;
  goalInput.disabled = state.isRunning;

  // Mission feedback
  if (state.currentTask.trim()) {
    missionFeedback.classList.add('visible');
  } else {
    missionFeedback.classList.remove('visible');
  }

  // Main button
  const btnText = activateBtn.querySelector('.btn-text');
  if (state.isRunning) {
    btnText.textContent = 'DEACTIVATE PATHPILOT';
    activateBtn.classList.add('stop-mode');
    activateBtn.classList.remove('success-state', 'loading');
  } else {
    btnText.textContent = 'ACTIVATE PATHPILOT';
    activateBtn.classList.remove('stop-mode', 'loading');
  }

  // Status indicator (header pill)
  if (state.isRunning) {
    statusDot.style.background = '#6366f1';
    statusDot.style.boxShadow = '0 0 10px rgba(99,102,241,0.8)';
    statusText.textContent = 'ACTIVE';
    statusText.style.color = '#818cf8';
    statusIndicator.style.background = 'rgba(99,102,241,0.12)';
    statusIndicator.style.border = '1px solid rgba(99,102,241,0.4)';
  } else {
    statusDot.style.background = '#ff3c3c';
    statusDot.style.boxShadow = '0 0 8px rgba(255,60,60,0.7)';
    statusText.textContent = 'STANDBY';
    statusText.style.color = '#ff5555';
    statusIndicator.style.background = 'rgba(255,60,60,0.1)';
    statusIndicator.style.border = '1px solid rgba(255,60,60,0.25)';
  }

  // Strict mode toggle
  if (state.strictMode) {
    toggleSwitch.classList.add('active');
  } else {
    toggleSwitch.classList.remove('active');
  }

  // Goal input style while running
  if (state.isRunning) {
    goalInput.style.opacity = '0.5';
    goalInput.style.cursor = 'not-allowed';
  } else {
    goalInput.style.opacity = '1';
    goalInput.style.cursor = 'text';
  }

  // Distraction count
  if (distractCount) {
    distractCount.textContent = state.distractionCount;
  }

  // Task list
  renderTasks();
}

// ── Task list renderer ─────────────────────────────────────
function renderTasks() {
  if (!popupTaskList) return;
  popupTaskList.innerHTML = '';

  if (state.tasks.length === 0) {
    popupTaskList.innerHTML = '<li class="task-empty">No critical moves defined yet.</li>';
    return;
  }

  state.tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `popup-task-item${task.done ? ' done' : ''}`;
    li.innerHTML = `
      <input type="checkbox" data-id="${task.id}" ${task.done ? 'checked' : ''}>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <button class="task-delete-btn" data-id="${task.id}" title="Delete task">✕</button>
    `;
    popupTaskList.appendChild(li);
  });

  // Checkbox toggle
  popupTaskList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      const id = parseInt(e.target.getAttribute('data-id'));
      const task = state.tasks.find(t => t.id === id);
      if (task) {
        task.done = e.target.checked;
        chrome.runtime.sendMessage({ type: 'COMPLETE_TASK', id, done: task.done });
        render();
      }
    });
  });

  // Delete buttons
  popupTaskList.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = parseInt(e.currentTarget.getAttribute('data-id'));
      deleteTask(id);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Delete task — always via background → storage → state sync ─────────────
function deleteTask(id) {
  chrome.runtime.sendMessage({ type: 'DELETE_TASK', id }, (newState) => {
    if (newState && newState.taskList !== undefined) {
      // Sync from persisted background state
      state.tasks = newState.taskList;
      state.distractionCount = newState.distractionCount || 0;
    }
    render();
  });
}

// ── Load state from background on popup open ──────────────
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (bgState) => {
    if (bgState) {
      state.currentTask = bgState.userGoal || '';
      state.tasks = bgState.taskList || [];
      state.isRunning = bgState.isMonitoring || false;
      state.isMonitoring = bgState.isMonitoring || false;
      state.distractionCount = bgState.distractionCount || 0;
      state.strictMode = bgState.strictMode || false;
    }
    chrome.storage.local.get(['strictMode'], (res) => {
      if (typeof res.strictMode === 'boolean') {
        state.strictMode = res.strictMode;
      }
      render();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.strictMode) {
      state.strictMode = changes.strictMode.newValue;
      render();
    }
  });

  // ── Goal input handler ───────────────────────────────────
  goalInput.addEventListener('input', () => {
    state.currentTask = goalInput.value;
    render();
  });

  const micBtn = document.getElementById('mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', initMic);
  }

  // ── Strict mode toggle ───────────────────────────────────
  toggleSwitch.addEventListener('click', () => {
    state.strictMode = !state.strictMode;
    chrome.storage.local.set({ strictMode: state.strictMode });
    chrome.runtime.sendMessage({ type: 'SET_STRICT_MODE', value: state.strictMode });
    render();
  });

  // ── Main button (START / STOP) ───────────────────────────
  activateBtn.addEventListener('click', () => {
    if (state.isRunning) {
      // ── STOP ──
      chrome.runtime.sendMessage({ type: 'STOP_MONITORING' }, () => {
        state.isRunning = false;
        state.isMonitoring = false;
        render();
      });
    } else {
      // ── START ──
      const goal = goalInput.value.trim();
      if (!goal) {
        goalInput.focus();
        goalInput.classList.add('input-error');
        setTimeout(() => goalInput.classList.remove('input-error'), 800);
        return;
      }
      state.currentTask = goal;

      const btnText = activateBtn.querySelector('.btn-text');
      const loadingText = activateBtn.querySelector('.loading-text');
      activateBtn.classList.add('loading');
      btnText.style.opacity = '0';
      if (loadingText) { loadingText.textContent = 'Initializing PathPilot...'; loadingText.style.opacity = '1'; }

      chrome.runtime.sendMessage({ type: 'SET_GOAL', goal }, () => {
        chrome.runtime.sendMessage({ type: 'SET_STRICT_MODE', value: state.strictMode }, () => {
          state.isRunning = true;
          state.isMonitoring = true;

          activateBtn.classList.remove('loading');
          if (loadingText) loadingText.style.opacity = '0';
          btnText.style.opacity = '1';
          render();
        });
      });
    }
  });

  // ── Add task (inline) ────────────────────────────────────
  function addTask() {
    const text = taskInput ? taskInput.value.trim() : '';
    if (!text) return;

    const newTask = { id: Date.now(), text, done: false };
    state.tasks.push(newTask);
    chrome.runtime.sendMessage({ type: 'ADD_TASK', text });
    taskInput.value = '';
    render();
  }

  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', addTask);
  }

  if (taskInput) {
    taskInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') addTask();
    });
  }

  // ── Open sidepanel ───────────────────────────────────────
  openPanelBtn.addEventListener('click', () => {
    chrome.windows.getCurrent({ populate: true }, (win) => {
      chrome.sidePanel.open({ windowId: win.id });
    });
  });

  // ── Ripple effects ───────────────────────────────────────
  [activateBtn, openPanelBtn].forEach(btn => {
    btn.addEventListener('mousedown', function (e) {
      const ripple = document.createElement('div');
      ripple.classList.add('ripple');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
});
