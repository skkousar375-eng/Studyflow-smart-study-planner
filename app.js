(() => {
  'use strict';

  const KEYS = { accounts: 'studyflow.accounts.v1', session: 'studyflow.session.v1', dataPrefix: 'studyflow.data.v1:' };
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MODES = { focus: { seconds: 25 * 60, label: 'TIME TO FOCUS', button: 'Start focus' }, short: { seconds: 5 * 60, label: 'SHORT BREAK', button: 'Start break' }, long: { seconds: 15 * 60, label: 'LONG BREAK', button: 'Start break' } };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const el = (id) => document.getElementById(id);
  const safeParse = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const todayISO = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const dayIndexMondayFirst = (date = new Date()) => (date.getDay() + 6) % 7;
  const dateFromISO = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  let currentUser = null;
  let data = null;
  let authMode = 'signin';
  let activeView = 'dashboard';
  let taskFilter = 'all';
  let editorType = 'task';
  let editingId = null;
  let timerMode = 'focus';
  let timerRemaining = MODES.focus.seconds;
  let timerInterval = null;
  let timerEndsAt = null;
  let activeFocusSubject = 'General';

  function freshData() {
    return { tasks: [], sessions: [], focusLog: [], studyDates: [], weeklyGoal: 10 };
  }

  function loadData(email) {
    const loaded = safeParse(localStorage.getItem(KEYS.dataPrefix + email), freshData());
    data = {
      tasks: Array.isArray(loaded.tasks) ? loaded.tasks : [],
      sessions: Array.isArray(loaded.sessions) ? loaded.sessions : [],
      focusLog: Array.isArray(loaded.focusLog) ? loaded.focusLog : [],
      studyDates: Array.isArray(loaded.studyDates) ? loaded.studyDates : [],
      weeklyGoal: Number.isInteger(loaded.weeklyGoal) && loaded.weeklyGoal >= 1 && loaded.weeklyGoal <= 80 ? loaded.weeklyGoal : 10
    };
  }

  function persistData() {
    if (!currentUser || !data) return false;
    try {
      localStorage.setItem(KEYS.dataPrefix + currentUser.email, JSON.stringify(data));
      return true;
    } catch {
      showToast('Could not save your data. Check available browser storage.', true);
      return false;
    }
  }

  function getAccounts() {
    const accounts = safeParse(localStorage.getItem(KEYS.accounts), []);
    return Array.isArray(accounts) ? accounts : [];
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    el('name-field').classList.toggle('hidden', !signup);
    el('signin-tab').classList.toggle('active', !signup);
    el('signup-tab').classList.toggle('active', signup);
    el('signin-tab').setAttribute('aria-selected', String(!signup));
    el('signup-tab').setAttribute('aria-selected', String(signup));
    el('auth-heading').innerHTML = signup ? 'Make room for<br><span>what matters.</span>' : 'Welcome back to<br><span>your rhythm.</span>';
    el('auth-submit-label').textContent = signup ? 'Create account' : 'Sign in';
    el('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
    el('auth-error').textContent = '';
  }

  function submitAuth(event) {
    event.preventDefault();
    const email = el('auth-email').value.trim().toLowerCase();
    const password = el('auth-password').value;
    const error = el('auth-error');
    error.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = 'Enter a valid email address.';
      el('auth-email').focus();
      return;
    }
    if (password.length < 8) {
      error.textContent = 'Your password must be at least 8 characters.';
      el('auth-password').focus();
      return;
    }
    const accounts = getAccounts();
    let account;
    if (authMode === 'signup') {
      const name = el('auth-name').value.trim();
      if (name.length < 2) {
        error.textContent = 'Please enter a name with at least 2 characters.';
        el('auth-name').focus();
        return;
      }
      if (accounts.some((entry) => entry.email === email)) {
        error.textContent = 'An account with this email already exists. Sign in instead.';
        return;
      }
      account = { email, password, name };
      accounts.push(account);
      try {
        localStorage.setItem(KEYS.accounts, JSON.stringify(accounts));
      } catch {
        error.textContent = 'Could not save your account. Check available browser storage.';
        return;
      }
    } else {
      account = accounts.find((entry) => entry.email === email && entry.password === password);
      if (!account) {
        error.textContent = 'That email and password combination was not found.';
        return;
      }
    }
    try {
      localStorage.setItem(KEYS.session, JSON.stringify({ email: account.email }));
    } catch {
      error.textContent = 'Could not start your session. Check available browser storage.';
      return;
    }
    startApp(account);
  }

  function startApp(account) {
    currentUser = account;
    loadData(account.email);
    el('auth-screen').classList.add('hidden');
    el('app-shell').classList.remove('hidden');
    const name = account.name || account.email.split('@')[0];
    el('user-name').textContent = name;
    el('user-email').textContent = account.email;
    el('user-avatar').textContent = (name.trim()[0] || 'S').toUpperCase();
    el('greeting-name').textContent = name.split(/\s+/)[0];
    el('today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
    renderAll();
    showView(activeView);
  }

  function signOut() {
    stopTimer(false);
    currentUser = null;
    data = null;
    localStorage.removeItem(KEYS.session);
    el('app-shell').classList.add('hidden');
    el('auth-screen').classList.remove('hidden');
    el('auth-form').reset();
    setAuthMode('signin');
  }

  function showView(name) {
    if (!['dashboard', 'tasks', 'schedule', 'focus', 'settings'].includes(name)) return;
    activeView = name;
    $$('.view-panel').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${name}`));
    $$('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === name));
    const labels = { dashboard: 'Overview', tasks: 'Tasks', schedule: 'Study plan', focus: 'Focus timer', settings: 'Goals & settings' };
    el('current-page-label').textContent = labels[name];
    if (name === 'focus') renderFocusStats();
    if (name === 'settings') renderSettings();
  }

  function renderAll() {
    renderDashboard();
    renderTasks();
    renderSchedule();
    renderSubjectInsights();
    refreshFocusSubjects();
    renderFocusStats();
    el('nav-task-count').textContent = String(data.tasks.filter((task) => !task.completed).length);
  }

  function focusMinutes() {
    return data.focusLog.reduce((sum, record) => sum + (Number(record.minutes) || 0), 0);
  }

  function currentStreak() {
    const dates = new Set(data.studyDates);
    let cursor = todayISO();
    if (!dates.has(cursor)) {
      const yesterday = dateFromISO(cursor);
      yesterday.setDate(yesterday.getDate() - 1);
      cursor = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      if (!dates.has(cursor)) return 0;
    }
    let streak = 0;
    const check = dateFromISO(cursor);
    while (dates.has(`${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, '0')}-${String(check.getDate()).padStart(2, '0')}`)) {
      streak += 1;
      check.setDate(check.getDate() - 1);
    }
    return streak;
  }

  function startOfWeek(date = new Date()) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() - dayIndexMondayFirst(result));
    return result;
  }

  function renderDashboard() {
    const minutes = focusMinutes();
    const totalHours = minutes / 60;
    el('metric-hours').textContent = totalHours < 10 && totalHours % 1 ? totalHours.toFixed(1) : String(Math.floor(totalHours));
    el('metric-completed').textContent = String(data.tasks.filter((task) => task.completed).length);
    const now = dateFromISO(todayISO());
    const thirtyDays = new Date(now);
    thirtyDays.setDate(now.getDate() + 30);
    el('metric-exams').textContent = String(data.tasks.filter((task) => (task.kind === 'exam') && !task.completed && task.due && dateFromISO(task.due) >= now && dateFromISO(task.due) <= thirtyDays).length);
    el('metric-streak').textContent = String(currentStreak());

    const weekStart = startOfWeek();
    const weekDates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    const dailyMinutes = weekDates.map((date) => data.focusLog.filter((record) => record.date === date).reduce((sum, record) => sum + (Number(record.minutes) || 0), 0));
    const weekMinutes = dailyMinutes.reduce((sum, item) => sum + item, 0);
    const weekHours = weekMinutes / 60;
    const goal = data.weeklyGoal;
    const percent = Math.min(100, Math.round(weekHours / goal * 100));
    el('week-hours').textContent = weekHours < 10 && weekHours % 1 ? weekHours.toFixed(1) : String(Math.floor(weekHours));
    el('goal-target-label').textContent = ` / ${goal} ${goal === 1 ? 'hour' : 'hours'}`;
    el('goal-percent').textContent = `${percent}%`;
    el('goal-progress').style.width = `${percent}%`;
    const max = Math.max(...dailyMinutes, 60);
    const today = todayISO();
    el('week-chart').innerHTML = dailyMinutes.map((value, index) => `<div class="chart-bar-wrap" title="${value} focused minutes"><div class="chart-bar ${weekDates[index] === today ? 'today' : ''}" style="height:${Math.max(4, value / max * 100)}%"></div></div>`).join('');
    renderUpcoming();
  }

  function formatDate(value, options = { month: 'short', day: 'numeric' }) {
    return new Intl.DateTimeFormat(undefined, options).format(dateFromISO(value));
  }

  function renderUpcoming() {
    const tasks = data.tasks.filter((task) => !task.completed).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
    const target = el('upcoming-list');
    if (!tasks.length) {
      target.innerHTML = '<div class="empty-state"><i class="fa-regular fa-circle-check"></i><strong>Nothing on the horizon</strong>Your upcoming tasks will show up here.</div>';
      return;
    }
    target.innerHTML = tasks.map((task) => {
      const due = dateFromISO(task.due);
      const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(due);
      const daysLeft = Math.round((due - dateFromISO(todayISO())) / 86400000);
      const label = daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `In ${daysLeft} days`;
      return `<div class="upcoming-item"><div class="date-chip"><strong>${due.getDate()}</strong><small>${escapeHtml(month)}</small></div><div class="upcoming-copy"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.subject)}</small></div><span class="due-label">${label}</span></div>`;
    }).join('');
  }

  function taskSort(a, b) {
    const sort = el('task-sort').value;
    if (sort === 'priority') {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority] || a.due.localeCompare(b.due);
    }
    if (sort === 'title') return a.title.localeCompare(b.title);
    return a.due.localeCompare(b.due);
  }

  function renderTasks() {
    const search = el('task-search').value.trim().toLocaleLowerCase();
    const priority = el('task-priority-filter').value;
    const tasks = data.tasks.filter((task) => {
      const matchesStatus = taskFilter === 'all' || (taskFilter === 'completed' ? task.completed : !task.completed);
      const matchesPriority = priority === 'all' || (task.priority || 'medium') === priority;
      const matchesSearch = !search || `${task.title} ${task.subject}`.toLocaleLowerCase().includes(search);
      return matchesStatus && matchesPriority && matchesSearch;
    }).sort(taskSort);
    el('count-all').textContent = String(data.tasks.length);
    el('count-pending').textContent = String(data.tasks.filter((task) => !task.completed).length);
    el('count-completed').textContent = String(data.tasks.filter((task) => task.completed).length);
    $$('.filter-tab').forEach((button) => button.classList.toggle('active', button.dataset.status === taskFilter));
    const target = el('tasks-list');
    if (!tasks.length) {
      const hasSearch = Boolean(search || priority !== 'all');
      const title = hasSearch ? 'No matching tasks' : taskFilter === 'completed' ? 'No completed tasks yet' : taskFilter === 'pending' ? 'You’re all caught up' : 'A fresh start';
      const message = hasSearch ? 'Try another search or priority filter.' : taskFilter === 'completed' ? 'Complete a task and it will be waiting here.' : 'Add a task to give your study session direction.';
      target.innerHTML = `<div class="empty-state"><i class="fa-regular fa-clipboard"></i><strong>${title}</strong>${message}</div>`;
      return;
    }
    target.innerHTML = tasks.map((task) => {
      const overdue = !task.completed && task.due < todayISO();
      const priority = task.priority || 'medium';
      return `<article class="task-row ${task.completed ? 'completed' : ''}" data-id="${escapeHtml(task.id)}">
        <button class="task-check" type="button" data-action="toggle" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}">${task.completed ? '<i class="fa-solid fa-check"></i>' : ''}</button>
        <div class="task-main"><strong class="task-title">${escapeHtml(task.title)}</strong><span class="task-subject">${escapeHtml(task.subject)} · ${Number(task.duration)} min</span></div>
        <span class="priority-badge priority-${priority}">${priority[0].toUpperCase()}${priority.slice(1)}</span>
        <span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : ''}${escapeHtml(formatDate(task.due))}</span>
        <div class="task-actions"><button type="button" data-action="edit" aria-label="Edit task" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button><button class="delete-task" type="button" data-action="delete" aria-label="Delete task" title="Delete"><i class="fa-regular fa-trash-can"></i></button></div>
      </article>`;
    }).join('');
  }

  function subjectColor(subject) {
    let hash = 0;
    for (const char of subject.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return ['subject-violet', 'subject-blue', 'subject-green', 'subject-amber', 'subject-pink'][Math.abs(hash) % 5].replace('subject-violet', '');
  }

  function renderSchedule() {
    const todayIndex = dayIndexMondayFirst();
    const monday = startOfWeek();
    el('schedule-grid').innerHTML = DAYS.map((day, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const sessions = data.sessions.filter((session) => session.day === day).sort((a, b) => a.start.localeCompare(b.start));
      return `<section class="day-column ${index === todayIndex ? 'today-column' : ''}"><div class="day-heading"><span>${day.slice(0, 3)}</span><small>${date.getDate()} ${new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}</small></div>
        ${sessions.length ? sessions.map((session) => `<article class="session-card ${subjectColor(session.subject)}"><span class="session-time">${escapeHtml(session.start)} – ${escapeHtml(session.end)}</span><strong class="session-name">${escapeHtml(session.title)}</strong><span class="session-subject">${escapeHtml(session.subject)}</span><div class="session-actions"><button class="session-edit" type="button" data-edit-session="${escapeHtml(session.id)}" aria-label="Edit ${escapeHtml(session.title)}" title="Edit session"><i class="fa-regular fa-pen-to-square"></i></button><button class="session-delete" type="button" data-delete-session="${escapeHtml(session.id)}" aria-label="Delete ${escapeHtml(session.title)}" title="Delete session"><i class="fa-solid fa-xmark"></i></button></div></article>`).join('') : '<div class="schedule-empty"></div>'}
      </section>`;
    }).join('');
  }

  function renderFocusStats() {
    if (!data) return;
    const mins = focusMinutes();
    el('focus-total').textContent = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
    el('focus-today').textContent = String(data.focusLog.filter((record) => record.date === todayISO()).length);
  }

  function renderSubjectInsights() {
    const totals = new Map();
    for (const record of data.focusLog) {
      const subject = String(record.subject || 'General').trim() || 'General';
      const key = subject.toLocaleLowerCase();
      const current = totals.get(key) || { subject, minutes: 0 };
      current.minutes += Number(record.minutes) || 0;
      totals.set(key, current);
    }
    const subjects = [...totals.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const target = el('subject-insights');
    if (!subjects.length) {
      target.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><strong>Your subject insights start here</strong>Choose a subject when you focus to see where your study time goes.</div>';
      return;
    }
    const max = Math.max(...subjects.map((item) => item.minutes));
    target.innerHTML = subjects.map((item) => `<div class="subject-progress-row"><div class="subject-progress-heading"><strong>${escapeHtml(item.subject)}</strong><span>${Math.floor(item.minutes / 60)}h ${String(item.minutes % 60).padStart(2, '0')}m</span></div><div class="progress-track"><div class="progress-fill subject-progress-fill" style="width:${Math.max(3, item.minutes / max * 100)}%"></div></div></div>`).join('');
  }

  function refreshFocusSubjects() {
    const select = el('focus-subject');
    if (!select) return;
    const selected = select.value;
    const subjects = new Map([['general', 'General']]);
    [...data.tasks, ...data.sessions, ...data.focusLog].forEach((item) => {
      const subject = String(item.subject || '').trim();
      if (subject && !subjects.has(subject.toLocaleLowerCase())) subjects.set(subject.toLocaleLowerCase(), subject);
    });
    select.innerHTML = [...subjects.values()].map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');
    select.value = [...select.options].some((option) => option.value === selected) ? selected : 'General';
  }

  function renderSettings() {
    el('goal-input').value = String(data.weeklyGoal);
  }

  function saveGoal(event) {
    event.preventDefault();
    const goal = Number(el('goal-input').value);
    if (!Number.isInteger(goal) || goal < 1 || goal > 80) {
      showToast('Choose a weekly goal between 1 and 80 hours.', true);
      return;
    }
    const previousGoal = data.weeklyGoal;
    data.weeklyGoal = goal;
    if (persistData()) {
      renderDashboard();
      showToast(`Weekly goal updated to ${goal} ${goal === 1 ? 'hour' : 'hours'}.`);
    } else {
      data.weeklyGoal = previousGoal;
      renderSettings();
    }
  }

  function openEditor(type, item = null) {
    editorType = type;
    editingId = item ? item.id : null;
    el('editor-form').reset();
    el('editor-error').textContent = '';
    const isTask = type === 'task';
    el('task-fields').classList.toggle('hidden', !isTask);
    el('session-fields').classList.toggle('hidden', isTask);
    $$('input, select', el('task-fields')).forEach((control) => { control.disabled = !isTask; });
    $$('input, select', el('session-fields')).forEach((control) => { control.disabled = isTask; });
    el('modal-eyebrow').textContent = isTask ? 'MAKE A PLAN' : 'SAVE YOUR STUDY TIME';
    el('modal-title').textContent = item ? (isTask ? 'Edit task' : 'Edit session') : (isTask ? 'Add a task' : 'Add a study session');
    el('modal-save').textContent = item ? 'Save changes' : (isTask ? 'Save task' : 'Save session');
    if (isTask && item) {
      el('task-title').value = item.title;
      el('task-subject').value = item.subject;
      el('task-kind').value = item.kind || 'assignment';
      el('task-priority').value = item.priority;
      el('task-due').value = item.due;
      el('task-duration').value = item.duration;
    } else if (!isTask && item) {
      el('session-subject').value = item.subject;
      el('session-title').value = item.title;
      el('session-day').value = item.day;
      el('session-start').value = item.start;
      el('session-end').value = item.end;
    } else if (isTask) {
      el('task-due').value = todayISO();
    }
    el('modal-backdrop').classList.remove('hidden');
    (isTask ? el('task-title') : el('session-subject')).focus();
  }

  function closeEditor() {
    el('modal-backdrop').classList.add('hidden');
    editingId = null;
  }

  function saveEditor(event) {
    event.preventDefault();
    const error = el('editor-error');
    const isEditing = Boolean(editingId);
    const savedType = editorType;
    error.textContent = '';
    if (editorType === 'task') {
      const title = el('task-title').value.trim();
      const subject = el('task-subject').value.trim();
      const due = el('task-due').value;
      const duration = Number(el('task-duration').value);
      if (!title || !subject || !due || !Number.isInteger(duration) || duration < 5 || duration > 1440) {
        error.textContent = 'Complete every field. Study time must be between 5 and 1,440 minutes.';
        return;
      }
      const previous = data.tasks.find((task) => task.id === editingId);
      const task = { id: editingId || crypto.randomUUID(), title, subject, kind: el('task-kind').value, priority: el('task-priority').value, due, duration, completed: previous ? previous.completed : false, createdAt: previous ? previous.createdAt : Date.now() };
      if (editingId) data.tasks = data.tasks.map((entry) => entry.id === editingId ? task : entry);
      else data.tasks.push(task);
    } else {
      const subject = el('session-subject').value.trim();
      const title = el('session-title').value.trim();
      const day = el('session-day').value;
      const start = el('session-start').value;
      const end = el('session-end').value;
      if (!subject || !title || !DAYS.includes(day) || !start || !end || start >= end) {
        error.textContent = 'Enter a subject, title, valid day, and an end time after the start time.';
        return;
      }
      const session = { id: editingId || crypto.randomUUID(), subject, title, day, start, end };
      if (editingId) data.sessions = data.sessions.map((entry) => entry.id === editingId ? session : entry);
      else data.sessions.push(session);
    }
    const saved = persistData();
    closeEditor();
    renderAll();
    if (saved) showToast(savedType === 'task' ? (isEditing ? 'Task updated.' : 'Task added to your list.') : (isEditing ? 'Study session updated.' : 'Study session saved.'));
  }

  function handleTaskAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('.task-row');
    const task = data.tasks.find((item) => item.id === row.dataset.id);
    if (!task) return;
    if (button.dataset.action === 'toggle') {
      task.completed = !task.completed;
      task.completedAt = task.completed ? Date.now() : null;
      const saved = persistData();
      renderAll();
      if (saved) showToast(task.completed ? 'Task completed. Nicely done!' : 'Task moved back to your list.');
    } else if (button.dataset.action === 'edit') {
      openEditor('task', task);
    } else if (button.dataset.action === 'delete') {
      data.tasks = data.tasks.filter((item) => item.id !== task.id);
      const saved = persistData();
      renderAll();
      if (saved) showToast('Task deleted.');
    }
  }

  function setTimerMode(mode) {
    if (!MODES[mode]) return;
    stopTimer(false);
    timerMode = mode;
    timerRemaining = MODES[mode].seconds;
    $$('.timer-mode').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    el('timer-mode-label').textContent = MODES[mode].label;
    el('timer-message').textContent = mode === 'focus' ? 'You’ve got this. Start when you’re ready.' : 'Take a breath. You’ve earned this pause.';
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timerRemaining / 60);
    const seconds = timerRemaining % 60;
    el('timer-display').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const ratio = timerRemaining / MODES[timerMode].seconds;
    const degrees = Math.max(0, ratio * 360);
    el('timer-ring').style.background = `conic-gradient(#9283ff ${degrees}deg, #222c42 ${degrees}deg)`;
    el('timer-start').innerHTML = timerInterval ? '<i class="fa-solid fa-pause"></i> Pause session' : `<i class="fa-solid fa-play"></i> ${MODES[timerMode].button}`;
  }

  function startTimer() {
    if (timerInterval) {
      timerRemaining = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
      stopTimer(false);
      el('timer-message').textContent = 'Paused. Take your time.';
      return;
    }
    if (timerRemaining === 0) timerRemaining = MODES[timerMode].seconds;
    timerEndsAt = Date.now() + timerRemaining * 1000;
    if (timerMode === 'focus') activeFocusSubject = el('focus-subject').value || 'General';
    el('timer-message').textContent = timerMode === 'focus' ? 'Stay present. You’re doing great.' : 'Enjoy a moment to recharge.';
    timerInterval = window.setInterval(() => {
      timerRemaining = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
      updateTimerDisplay();
      if (timerRemaining <= 0) completeTimer();
    }, 250);
    updateTimerDisplay();
  }

  function stopTimer(resetRemaining) {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
    timerEndsAt = null;
    if (resetRemaining) timerRemaining = MODES[timerMode].seconds;
    if (el('timer-display')) updateTimerDisplay();
  }

  function completeTimer() {
    const completedMode = timerMode;
    stopTimer(false);
    timerRemaining = 0;
    if (completedMode === 'focus') {
      const minutes = Math.round(MODES.focus.seconds / 60);
      data.focusLog.push({ id: crypto.randomUUID(), date: todayISO(), minutes, subject: activeFocusSubject, completedAt: Date.now() });
      data.studyDates = [...new Set([...data.studyDates, todayISO()])];
      const saved = persistData();
      renderAll();
      if (saved) showToast('Focus session complete — 25 minutes added to your progress!');
      el('timer-message').textContent = 'Beautiful work. Take a short break.';
    } else {
      showToast('Break complete. Ready to focus again?');
      el('timer-message').textContent = 'Break complete. You’re ready for another round.';
    }
    updateTimerDisplay();
    playBeep();
  }

  function playBeep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.16, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.6);
      oscillator.onended = () => context.close();
    } catch {
      showToast('Timer finished. Your browser could not play the audio alert.', true);
    }
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error-toast' : ''}`;
    toast.innerHTML = `<i class="fa-solid ${isError ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>${escapeHtml(message)}`;
    el('toast-region').append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function initialize() {
    el('session-day').innerHTML = DAYS.map((day) => `<option value="${day}">${day}</option>`).join('');
    el('auth-form').addEventListener('submit', submitAuth);
    el('signin-tab').addEventListener('click', () => setAuthMode('signin'));
    el('signup-tab').addEventListener('click', () => setAuthMode('signup'));
    el('signout-button').addEventListener('click', signOut);
    el('mobile-signout').addEventListener('click', signOut);
    $$('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    $$('[data-go]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.go)));
    el('quick-add-button').addEventListener('click', () => openEditor('task'));
    el('add-task-button').addEventListener('click', () => openEditor('task'));
    el('add-session-button').addEventListener('click', () => openEditor('session'));
    el('modal-close').addEventListener('click', closeEditor);
    el('modal-cancel').addEventListener('click', closeEditor);
    el('modal-backdrop').addEventListener('click', (event) => { if (event.target === el('modal-backdrop')) closeEditor(); });
    el('editor-form').addEventListener('submit', saveEditor);
    el('tasks-list').addEventListener('click', handleTaskAction);
    el('task-sort').addEventListener('change', renderTasks);
    el('task-search').addEventListener('input', renderTasks);
    el('task-priority-filter').addEventListener('change', renderTasks);
    $$('.filter-tab').forEach((button) => button.addEventListener('click', () => { taskFilter = button.dataset.status; renderTasks(); }));
    el('schedule-grid').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-session]');
      if (editButton) {
        const session = data.sessions.find((item) => item.id === editButton.dataset.editSession);
        if (session) openEditor('session', session);
        return;
      }
      const button = event.target.closest('[data-delete-session]');
      if (!button) return;
      data.sessions = data.sessions.filter((session) => session.id !== button.dataset.deleteSession);
      const saved = persistData();
      renderSchedule();
      if (saved) showToast('Study session removed.');
    });
    el('goal-form').addEventListener('submit', saveGoal);
    el('focus-subject').addEventListener('change', () => {
      if (timerInterval && timerMode === 'focus') activeFocusSubject = el('focus-subject').value;
    });
    $$('.timer-mode').forEach((button) => button.addEventListener('click', () => setTimerMode(button.dataset.mode)));
    el('timer-start').addEventListener('click', startTimer);
    el('timer-reset').addEventListener('click', () => { stopTimer(true); el('timer-message').textContent = 'Timer reset. Start when you’re ready.'; });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !el('modal-backdrop').classList.contains('hidden')) closeEditor();
    });
    const session = safeParse(localStorage.getItem(KEYS.session), null);
    const account = session && getAccounts().find((entry) => entry.email === session.email);
    if (account) startApp(account);
    else {
      localStorage.removeItem(KEYS.session);
      setAuthMode('signin');
    }
  }

  initialize();
})();
