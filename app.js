const KEY = 'myday.v2';
const START = 8 * 60;   // 08:00
const END = 17 * 60;    // 17:00
const WATER_GOAL = 8;
const MOODS = ['😣', '😕', '😐', '🙂', '😄'];
const ACCENTS = ['#4f6df5', '#2fa876', '#e5484d', '#f59e0b', '#8b5cf6', '#0ea5e9'];
const PROMPTS = [
  'What is one thing that went well today, and why?',
  'What would make tomorrow feel like a good day?',
  'What did you learn recently that surprised you?',
  'What are you grateful for right now?',
  'What is weighing on your mind, and what is one small step on it?',
  'Who made a difference for you this week?',
  'What is one thing you want to let go of?',
  'If today were your last day off, how would you spend it?'
];
const $ = s => document.querySelector(s);

const DEFAULTS = {
  events: [], todos: [], habits: [], notes: [],
  priorities: {}, pomo: {}, checkins: {}, water: {}, sleep: {},
  lastPrompt: '', lastNudge: '',
  settings: { theme: 'light', accent: ACCENTS[0], city: '', units: 'C', reminders: false, dailyPrompt: true }
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  return { ...structuredClone(DEFAULTS), ...saved, settings: { ...DEFAULTS.settings, ...(saved.settings || {}) } };
}
let state = load();
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  queueRemoteSave();
}

let saveTimer;
function queueRemoteSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true
    }).catch(() => toast('Offline: changes are saved on this device only'));
  }, 400);
}

async function loadRemote() {
  try {
    const res = await fetch('api/state', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Object.keys(data).length) {
      state = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) } };
      localStorage.setItem(KEY, JSON.stringify(state));
    } else {
      queueRemoteSave();
    }
  } catch {}
}

let viewDate = todayStr();
let calMode = 'day';
let noteId = null;
let noteFilter = null;
let heatMonth = todayStr();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function todayStr() { return fmtKey(new Date()); }
function parseKey(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseKey(s); d.setDate(d.getDate() + n); return fmtKey(d); }
function addMonths(s, n) { const d = parseKey(s); d.setDate(1); d.setMonth(d.getMonth() + n); return fmtKey(d); }
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const label = min => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------- Toast & notifications ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 3500);
}
function notify(title, body) {
  toast(`${title}: ${body}`);
  if (state.settings.reminders && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

/* ---------- Theme ---------- */
function applySettings() {
  const s = state.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', s.accent);
}
function saveSettings() { save(); applySettings(); }
function fillSettings() {
  const s = state.settings;
  $('#s-theme').value = s.theme;
  $('#s-units').value = s.units;
  $('#s-city').value = s.city;
  $('#s-reminders').checked = s.reminders;
  $('#s-prompt').checked = s.dailyPrompt;
  $('#s-accent').innerHTML = ACCENTS.map(c =>
    `<button class="swatch ${c === s.accent ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
}

/* ---------- Clock, date, greeting ---------- */
let lastDay = todayStr();
let lastMin = -1;
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#today-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const h = now.getHours();
  $('#greet').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  if (todayStr() !== lastDay) {
    lastDay = todayStr();
    if (viewDate === addDays(lastDay, -1)) viewDate = lastDay;
    ensureDailyPrompt();
    renderAll();
  } else if (now.getMinutes() !== lastMin) {
    lastMin = now.getMinutes();
    renderCalendar();
    checkReminders();
  }
}

/* ---------- Weather ---------- */
function wxIcon(c) {
  if (c === 0) return '☀️';
  if (c <= 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c <= 48) return '🌫️';
  if (c <= 57) return '🌦️';
  if (c <= 67) return '🌧️';
  if (c <= 77) return '🌨️';
  if (c <= 82) return '🌦️';
  return '⛈️';
}
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

async function loadWeather() {
  const el = $('#weather');
  el.textContent = 'Loading weather…';
  try {
    let lat, lon, place = '';
    const city = state.settings.city.trim();
    if (city) {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
      if (!g.results) throw new Error('city not found');
      ({ latitude: lat, longitude: lon, name: place } = g.results[0]);
    } else {
      if (!navigator.geolocation) throw new Error('no geolocation');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
      ({ latitude: lat, longitude: lon } = pos.coords);
    }
    const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
    let t = w.current.temperature_2m, unit = '°C';
    if (state.settings.units === 'F') { t = t * 9 / 5 + 32; unit = '°F'; }
    el.textContent = `${wxIcon(w.current.weather_code)} ${Math.round(t)}${unit}${place ? ' · ' + place : ''}`;
  } catch {
    el.textContent = 'Weather unavailable. Set a city in Settings.';
  }
}

/* ---------- Calendar ---------- */
function renderCalendar() {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === calMode));
  $('#ev-form').hidden = calMode !== 'day';
  if (calMode === 'day') renderDay(); else renderMonth();
}

function renderDay() {
  $('#cal-label').textContent = (viewDate === todayStr() ? 'Today · ' : '') +
    parseKey(viewDate).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  let html = '<div class="timeline">';
  for (let h = 8; h <= 17; h++) {
    const top = h * 60 - START;
    html += `<div class="hlabel" style="top:${top}px">${label(h * 60)}</div>`;
    html += `<div class="hline" style="top:${top}px"></div>`;
    if (h < 17) html += `<div class="slot" data-min="${h * 60}" style="top:${top}px"></div>`;
  }

  const evs = state.events
    .filter(e => e.date === viewDate)
    .map(e => ({ ...e, s: Math.max(START, toMin(e.start)), e: Math.min(END, toMin(e.end)) }))
    .filter(e => e.e > e.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const laneEnds = [];
  evs.forEach(ev => {
    let i = laneEnds.findIndex(le => le <= ev.s);
    if (i < 0) { i = laneEnds.length; laneEnds.push(ev.e); } else laneEnds[i] = ev.e;
    ev.lane = i;
  });
  const lanes = Math.max(1, laneEnds.length);

  let layer = '';
  evs.forEach(ev => {
    const height = Math.max(24, ev.e - ev.s - 2);
    layer += `<button class="event" data-id="${ev.id}" title="Click to delete"
      style="top:${ev.s - START}px;height:${height}px;left:calc(${ev.lane * 100 / lanes}% + 2px);width:calc(${100 / lanes}% - 4px)">
      ${esc(ev.title)}<small>${label(toMin(ev.start))} – ${label(toMin(ev.end))}</small></button>`;
  });

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (viewDate === todayStr() && nowMin >= START && nowMin <= END) {
    html += `<div class="now" style="top:${nowMin - START}px"></div>`;
  }
  html += `<div class="events">${layer}</div></div>`;
  $('#cal-body').innerHTML = html;
}

function renderMonth() {
  const first = parseKey(viewDate);
  first.setDate(1);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const counts = {};
  state.events.forEach(e => counts[e.date] = (counts[e.date] || 0) + 1);
  const today = todayStr();

  $('#cal-label').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  let html = '<div class="mhead">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<span>${d}</span>`).join('') + '</div>';
  html += '<div class="mgrid">' + '<div></div>'.repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const key = fmtKey(new Date(y, m, d));
    const n = Math.min(counts[key] || 0, 3);
    html += `<button class="mcell ${key === today ? 'today' : ''} ${key === viewDate ? 'sel' : ''}" data-date="${key}">
      <span>${d}</span><div class="dots">${'<i></i>'.repeat(n)}</div></button>`;
  }
  $('#cal-body').innerHTML = html + '</div>';
}

function fillTimeSelects() {
  const opts = [];
  for (let m = START; m <= END; m += 30) opts.push(`<option value="${hhmm(m)}">${label(m)}</option>`);
  $('#ev-start').innerHTML = opts.join('');
  $('#ev-end').innerHTML = opts.join('');
  $('#ev-start').value = '09:00';
  $('#ev-end').value = '10:00';
}

/* ---------- Journal prompt ---------- */
function ensureDailyPrompt() {
  if (!state.settings.dailyPrompt || state.lastPrompt === todayStr()) return;
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const day = parseKey(todayStr()).toLocaleDateString([], { month: 'short', day: 'numeric' });
  state.notes.push({ id: uid(), title: `Journal · ${day}`, body: `${prompt}\n\n`, tags: ['journal'], updated: Date.now() });
  state.lastPrompt = todayStr();
  save();
  toast("Today's journal prompt is in Notes");
}

/* ---------- Reminders ---------- */
const alerted = new Set();
function checkReminders() {
  if (!state.settings.reminders) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayStr();

  state.events.filter(e => e.date === today).forEach(e => {
    const diff = toMin(e.start) - nowMin;
    if (diff >= 0 && diff <= 10 && !alerted.has(e.id)) {
      alerted.add(e.id);
      notify('Coming up', `${e.title} at ${label(toMin(e.start))}`);
    }
  });

  const left = state.habits.filter(h => !h.days.includes(today));
  if (nowMin >= 20 * 60 && state.habits.length && left.length && state.lastNudge !== today) {
    state.lastNudge = today;
    save();
    notify('Habits left today', left.map(h => h.name).join(', '));
  }
}

/* ---------- Focus priorities ---------- */
function todayPriorities() {
  const k = todayStr();
  if (!state.priorities[k]) {
    state.priorities[k] = [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }];
  }
  return state.priorities[k];
}
function renderPriorities() {
  const list = todayPriorities();
  $('#focus-count').textContent = `${list.filter(p => p.done && p.text).length} of 3 done`;
  $('#focus-list').innerHTML = list.map((p, i) => `
    <div class="prio">
      <span class="num">${i + 1}</span>
      <input class="prio-text" data-i="${i}" value="${esc(p.text)}" placeholder="Priority ${i + 1}" autocomplete="off">
      <input type="checkbox" class="prio-done" data-i="${i}" ${p.done ? 'checked' : ''} title="Done">
    </div>`).join('');
}

/* ---------- Pomodoro ---------- */
const POMO = { focus: 25 * 60, break: 5 * 60 };
const pomo = { mode: 'focus', left: POMO.focus, id: null };

function renderPomo() {
  $('#pomo-time').textContent = fmtTime(pomo.left);
  $('#pomo-start').textContent = pomo.id ? 'Pause' : 'Start';
  $('#pomo-today').textContent = `${state.pomo[todayStr()] || 0} min focused today`;
  document.querySelectorAll('[data-pomo]').forEach(b => b.classList.toggle('on', b.dataset.pomo === pomo.mode));
}
function setPomoMode(mode) {
  clearInterval(pomo.id);
  pomo.id = null;
  pomo.mode = mode;
  pomo.left = POMO[mode];
  renderPomo();
}
function pomoTick() {
  pomo.left--;
  if (pomo.left <= 0) {
    clearInterval(pomo.id);
    pomo.id = null;
    if (pomo.mode === 'focus') {
      const k = todayStr();
      state.pomo[k] = (state.pomo[k] || 0) + 25;
      save();
      notify('Focus session complete', 'Time for a break');
      setPomoMode('break');
    } else {
      notify('Break over', 'Back to focus');
      setPomoMode('focus');
    }
    return;
  }
  renderPomo();
}

/* ---------- To-do ---------- */
function renderTodos() {
  const done = state.todos.filter(t => t.done).length;
  $('#todo-count').textContent = state.todos.length ? `${done} of ${state.todos.length} done` : '';
  $('#todo-list').innerHTML = state.todos.length
    ? state.todos.map(t => `
      <div class="todo ${t.done ? 'done' : ''}">
        <input type="checkbox" data-act="toggle" data-id="${t.id}" ${t.done ? 'checked' : ''}>
        <span>${esc(t.text)}</span>
        <button class="icon" data-act="del-todo" data-id="${t.id}" title="Delete">&times;</button>
      </div>`).join('')
    : `<p class="muted">Nothing on the list. Enjoy the calm.</p>`;
}

/* ---------- Habits ---------- */
function streak(h) {
  const set = new Set(h.days);
  let d = todayStr();
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function renderHabits() {
  const today = todayStr();
  const week = [...Array(7)].map((_, i) => addDays(today, i - 6));
  $('#habit-list').innerHTML = state.habits.length
    ? state.habits.map(h => {
        const s = streak(h);
        return `
        <div class="habit">
          <div class="habit-top">
            <button class="check ${h.days.includes(today) ? 'on' : ''}" data-act="habit" data-id="${h.id}" title="Mark today">&#10003;</button>
            <span class="name">${esc(h.name)}</span>
            <button class="icon" data-act="del-habit" data-id="${h.id}" title="Delete">&times;</button>
          </div>
          <div class="habit-meta">
            <div class="week">${week.map(d => `
              <div class="day ${h.days.includes(d) ? 'on' : ''}">${parseKey(d).toLocaleDateString([], { weekday: 'narrow' })}<i></i></div>`).join('')}
            </div>
            <span class="streak">Streak <b>${s}</b> ${s === 1 ? 'day' : 'days'}</span>
          </div>
        </div>`;
      }).join('')
    : `<p class="muted">Add a habit to start building streaks.</p>`;
}

function renderHeat() {
  const first = parseKey(heatMonth);
  first.setDate(1);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  $('#heat-label').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const body = $('#heat-body');
  body.style.setProperty('--days', days);
  if (!state.habits.length) {
    body.innerHTML = '<p class="muted">Add a habit to see your monthly heatmap. Click a square to mark any past day.</p>';
    return;
  }
  let html = '<div class="hrow hhead"><span></span>' + [...Array(days)].map((_, i) => `<span>${i + 1}</span>`).join('') + '</div>';
  state.habits.forEach(h => {
    html += `<div class="hrow"><span class="hname" title="${esc(h.name)}">${esc(h.name)}</span>`;
    for (let d = 1; d <= days; d++) {
      const key = fmtKey(new Date(y, m, d));
      const on = h.days.includes(key);
      const future = key > today;
      html += `<button class="sq ${on ? 'on' : ''} ${key === today ? 'today' : ''}" data-habit="${h.id}" data-date="${key}" ${future ? 'disabled' : ''} title="${key}"></button>`;
    }
    html += '</div>';
  });
  body.innerHTML = html;
}

/* ---------- Wellness ---------- */
function renderWellness() {
  const k = todayStr();
  const c = state.checkins[k] || {};
  const w = state.water[k] || 0;
  $('#water').innerHTML = [...Array(WATER_GOAL)].map((_, i) =>
    `<button class="glass ${i < w ? 'on' : ''}" data-n="${i + 1}" title="${i + 1} glass${i ? 'es' : ''}"></button>`).join('');
  $('#water-label').textContent = `${w}/${WATER_GOAL}`;
  $('#sleep').value = state.sleep[k] ?? '';
  $('#mood').innerHTML = MOODS.map((mo, i) =>
    `<button class="mood-btn ${c.mood === i + 1 ? 'on' : ''}" data-mood="${i + 1}" title="Mood ${i + 1}/5">${mo}</button>`).join('');
  $('#energy').value = c.energy || 3;
  $('#energy-val').textContent = c.energy ? `${c.energy}/5` : 'not set';
}

function renderChart() {
  const days = [...Array(14)].map((_, i) => addDays(todayStr(), i - 13));
  const W = 300, pad = 12;
  const x = i => pad + i * (W - 2 * pad) / 13;
  const y = v => 10 + (5 - v) / 4 * 80;   // 1 at bottom, 5 at top
  const series = (get, cls) => {
    const pts = days.map((d, i) => { const v = get(d); return v == null ? null : { x: x(i), y: y(v) }; }).filter(Boolean);
    if (!pts.length) return '';
    return `<polyline class="line ${cls}" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"></polyline>` +
      pts.map(p => `<circle class="pt ${cls}" cx="${p.x}" cy="${p.y}" r="3"></circle>`).join('');
  };
  $('#chart').innerHTML =
    series(d => state.checkins[d]?.mood, 'mood') +
    series(d => state.checkins[d]?.energy, 'energy') +
    `<text class="ax" x="${pad}" y="118">${parseKey(days[0]).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>` +
    `<text class="ax" x="${W - pad}" y="118" text-anchor="end">Today</text>`;
}

/* ---------- Notes ---------- */
function noteTags(n) {
  const inBody = (n.body.match(/#[\w-]+/g) || []).map(t => t.slice(1));
  return [...new Set([...n.tags, ...inBody].map(t => t.toLowerCase()))].sort();
}
function currentNote() { return state.notes.find(x => x.id === noteId); }

function renderSidebar() {
  const counts = {};
  state.notes.forEach(n => noteTags(n).forEach(t => counts[t] = (counts[t] || 0) + 1));
  if (noteFilter && !counts[noteFilter]) noteFilter = null;

  $('#tag-chips').innerHTML =
    `<button class="chip ${!noteFilter ? 'on' : ''}" data-tag="">All</button>` +
    Object.keys(counts).map(t =>
      `<button class="chip ${noteFilter === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)} <i>${counts[t]}</i></button>`).join('');

  const q = $('#n-search').value.trim().toLowerCase();
  const list = state.notes
    .filter(n => (!noteFilter || noteTags(n).includes(noteFilter)) &&
      (!q || `${n.title} ${n.body} ${noteTags(n).join(' ')}`.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated);

  $('#note-list').innerHTML = list.length
    ? list.map(n => `
      <button class="note-item ${n.id === noteId ? 'on' : ''}" data-id="${n.id}">
        <strong>${esc(n.title || 'Untitled')}</strong>
        <span>${esc(n.body.slice(0, 80) || 'No content')}</span>
        <div class="tags">${noteTags(n).map(t => `<em>#${esc(t)}</em>`).join(' ')}</div>
      </button>`).join('')
    : `<p class="muted">No notes match.</p>`;
}

function renderEditor() {
  const n = currentNote();
  $('#editor-empty').hidden = !!n;
  $('#editor-body').hidden = !n;
  if (!n) return;
  $('#n-title').value = n.title;
  $('#n-tags').value = n.tags.join(', ');
  $('#n-body').value = n.body;
}

function renderNotes() { renderSidebar(); renderEditor(); }

/* ---------- Render all ---------- */
function renderAll() {
  renderCalendar();
  renderPriorities();
  renderPomo();
  renderTodos();
  renderHabits();
  renderWellness();
  renderChart();
  renderHeat();
  renderNotes();
}

/* ---------- Calendar events ---------- */
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { calMode = b.dataset.mode; renderCalendar(); });
$('#prev').onclick = () => { viewDate = calMode === 'day' ? addDays(viewDate, -1) : addMonths(viewDate, -1); renderCalendar(); };
$('#next').onclick = () => { viewDate = calMode === 'day' ? addDays(viewDate, 1) : addMonths(viewDate, 1); renderCalendar(); };
$('#cal-today').onclick = () => { viewDate = todayStr(); renderCalendar(); };

$('#cal-body').addEventListener('click', e => {
  const ev = e.target.closest('.event');
  if (ev) {
    if (confirm('Delete this event?')) {
      state.events = state.events.filter(x => x.id !== ev.dataset.id);
      save(); renderCalendar();
    }
    return;
  }
  const slot = e.target.closest('.slot');
  if (slot) {
    const s = +slot.dataset.min;
    $('#ev-start').value = hhmm(s);
    $('#ev-end').value = hhmm(Math.min(END, s + 60));
    $('#ev-title').focus();
    return;
  }
  const cell = e.target.closest('.mcell');
  if (cell) { viewDate = cell.dataset.date; calMode = 'day'; renderCalendar(); }
});

$('#ev-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#ev-title').value.trim();
  const start = $('#ev-start').value, end = $('#ev-end').value;
  if (!title) return;
  if (toMin(end) <= toMin(start)) { alert('End time must be after start time.'); return; }
  state.events.push({ id: uid(), date: viewDate, title, start, end });
  save();
  $('#ev-title').value = '';
  renderCalendar();
});

/* ---------- Priorities ---------- */
$('#focus-list').addEventListener('input', e => {
  if (!e.target.matches('.prio-text')) return;
  todayPriorities()[+e.target.dataset.i].text = e.target.value;
  save();
});
$('#focus-list').addEventListener('change', e => {
  if (!e.target.matches('.prio-done')) return;
  todayPriorities()[+e.target.dataset.i].done = e.target.checked;
  save(); renderPriorities();
});

/* ---------- Pomodoro events ---------- */
document.querySelectorAll('[data-pomo]').forEach(b => b.onclick = () => setPomoMode(b.dataset.pomo));
$('#pomo-start').onclick = () => {
  if (pomo.id) { clearInterval(pomo.id); pomo.id = null; }
  else pomo.id = setInterval(pomoTick, 1000);
  renderPomo();
};
$('#pomo-reset').onclick = () => setPomoMode(pomo.mode);

/* ---------- To-do events ---------- */
$('#todo-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#todo-input').value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, done: false });
  save();
  $('#todo-input').value = '';
  renderTodos();
});
$('#todo-list').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'toggle') {
    state.todos.find(x => x.id === el.dataset.id).done = el.checked;
  }
  if (el.dataset.act === 'del-todo') {
    state.todos = state.todos.filter(x => x.id !== el.dataset.id);
  }
  save(); renderTodos();
});
$('#todo-clear').onclick = () => {
  state.todos = state.todos.filter(t => !t.done);
  save(); renderTodos();
};

/* ---------- Habit events ---------- */
$('#habit-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#habit-input').value.trim();
  if (!name) return;
  state.habits.push({ id: uid(), name, days: [] });
  save();
  $('#habit-input').value = '';
  renderHabits(); renderHeat();
});
$('#habit-list').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const h = state.habits.find(x => x.id === el.dataset.id);
  if (el.dataset.act === 'habit') {
    const today = todayStr();
    h.days = h.days.includes(today) ? h.days.filter(d => d !== today) : [...h.days, today];
  }
  if (el.dataset.act === 'del-habit') {
    if (!confirm(`Delete habit "${h.name}"?`)) return;
    state.habits = state.habits.filter(x => x.id !== h.id);
  }
  save(); renderHabits(); renderHeat();
});
$('#heat-prev').onclick = () => { heatMonth = addMonths(heatMonth, -1); renderHeat(); };
$('#heat-next').onclick = () => { heatMonth = addMonths(heatMonth, 1); renderHeat(); };
$('#heat-body').addEventListener('click', e => {
  const sq = e.target.closest('[data-habit]');
  if (!sq) return;
  const h = state.habits.find(x => x.id === sq.dataset.habit);
  const d = sq.dataset.date;
  h.days = h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d];
  save(); renderHabits(); renderHeat();
});

/* ---------- Wellness events ---------- */
$('#water').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  const k = todayStr(), n = +b.dataset.n, w = state.water[k] || 0;
  state.water[k] = w === n ? n - 1 : n;
  save(); renderWellness();
});
$('#sleep').addEventListener('change', e => {
  const k = todayStr();
  if (e.target.value === '') delete state.sleep[k];
  else state.sleep[k] = +e.target.value;
  save();
});
$('#mood').addEventListener('click', e => {
  const b = e.target.closest('[data-mood]');
  if (!b) return;
  const k = todayStr();
  const c = state.checkins[k] ||= {};
  const v = +b.dataset.mood;
  c.mood = c.mood === v ? undefined : v;
  save(); renderWellness(); renderChart();
});
$('#energy').addEventListener('input', e => {
  const k = todayStr();
  state.checkins[k] = { ...(state.checkins[k] || {}), energy: +e.target.value };
  save();
  $('#energy-val').textContent = `${e.target.value}/5`;
  renderChart();
});

/* ---------- Notes events ---------- */
$('#note-new').onclick = () => {
  const n = { id: uid(), title: '', body: '', tags: noteFilter ? [noteFilter] : [], updated: Date.now() };
  state.notes.push(n);
  noteId = n.id;
  save(); renderNotes();
  $('#n-title').focus();
};
$('#n-delete').onclick = () => {
  const n = currentNote();
  if (!n || !confirm(`Delete "${n.title || 'Untitled'}"?`)) return;
  state.notes = state.notes.filter(x => x.id !== n.id);
  noteId = null;
  save(); renderNotes();
};
$('#n-title').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.title = e.target.value; n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-tags').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.tags = [...new Set(e.target.value.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
  n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-body').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.body = e.target.value; n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-search').addEventListener('input', renderSidebar);
$('#tag-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  noteFilter = chip.dataset.tag || null;
  renderSidebar();
});
$('#note-list').addEventListener('click', e => {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  noteId = item.dataset.id;
  renderNotes();
});

$('#capture-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#capture-input').value.trim();
  if (!text) return;
  state.notes.push({ id: uid(), title: text.slice(0, 60), body: text, tags: ['inbox'], updated: Date.now() });
  save();
  $('#capture-input').value = '';
  renderSidebar();
  toast('Captured to Inbox');
});

/* ---------- Settings events ---------- */
$('#settings-btn').onclick = () => { fillSettings(); $('#settings').hidden = false; };
$('#settings-close').onclick = () => { $('#settings').hidden = true; };
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });
$('#s-theme').onchange = e => { state.settings.theme = e.target.value; saveSettings(); };
$('#s-accent').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  state.settings.accent = b.dataset.color;
  saveSettings(); fillSettings();
});
$('#s-city').onchange = e => { state.settings.city = e.target.value.trim(); saveSettings(); loadWeather(); };
$('#s-units').onchange = e => { state.settings.units = e.target.value; saveSettings(); loadWeather(); };
$('#s-reminders').onchange = e => {
  if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  state.settings.reminders = e.target.checked;
  saveSettings();
};
$('#s-prompt').onchange = e => { state.settings.dailyPrompt = e.target.checked; saveSettings(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `myday-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object') throw new Error();
    state = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) } };
    save(); applySettings(); renderAll(); fillSettings(); loadWeather();
    toast('Backup imported');
  } catch {
    alert('That file is not a valid backup.');
  }
  e.target.value = '';
});

/* ---------- Init ---------- */
async function startApp() {
  await loadRemote();
  fillTimeSelects();
  applySettings();
  ensureDailyPrompt();
  tick();
  setInterval(tick, 1000);
  renderAll();
  loadWeather();
  setInterval(loadWeather, 30 * 60 * 1000);
}

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  await loadRemote();
  applySettings();
  renderAll();
});

startApp();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
