import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection,
  query, orderBy, onSnapshot, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';

const $ = (id) => document.getElementById(id);
const config = self.FIREBASE_CONFIG || {};
const VAPID_KEY = self.FIREBASE_VAPID_KEY;

/* ---------- Local settings (this phone only) ---------- */
const store = {
  get: (k) => { try { return localStorage.getItem('jojo.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('jojo.' + k) : localStorage.setItem('jojo.' + k, v); } catch {} },
};
const me = {
  get family() { return store.get('family'); },
  get role() { return store.get('role'); },
  get name() { return store.get('name') || (store.get('role') === 'jojo' ? 'JoJo' : 'Family'); },
  get deviceId() {
    let id = store.get('deviceId');
    if (!id) { id = crypto.randomUUID(); store.set('deviceId', id); }
    return id;
  },
};
const isJojo = () => me.role === 'jojo';

/* ---------- Views ---------- */
const views = ['loading', 'config', 'welcome', 'join', 'main'];
function show(view) {
  views.forEach((v) => { $('view-' + v).hidden = v !== view; });
  $('settingsBtn').hidden = view !== 'main';
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Firebase ---------- */
if (!config.apiKey || config.apiKey.startsWith('PASTE')) {
  show('config');
  throw new Error('Firebase is not configured yet — edit public/firebase-config.js');
}
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const familyRef = () => doc(db, 'families', me.family);
const remindersCol = () => collection(db, 'families', me.family, 'reminders');

/* ---------- Date helpers ---------- */
const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dayFmt.format(d);
}
const whenText = (d) => `${dayLabel(d)} at ${timeFmt.format(d)}`;

const REPEAT_LABEL = { none: '', daily: '🔁 Every day', weekly: '🔁 Every week', monthly: '🔁 Every month', yearly: '🔁 Every year' };

/** Same rules as functions/schedule.js, using this phone's local time. */
function addRepeat(anchor, repeat, n) {
  const d = new Date(anchor);
  if (repeat === 'daily') d.setDate(d.getDate() + n);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (repeat === 'monthly' || repeat === 'yearly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + (repeat === 'yearly' ? 12 * n : n));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  return d;
}
function nextOccurrence(anchor, repeat, after) {
  if (repeat === 'none') return null;
  for (let n = 1; n < 100000; n++) {
    const d = addRepeat(anchor, repeat, n);
    if (d > after) return d;
  }
  return null;
}

/* ---------- Setup flow ---------- */
let pendingRole = null;

function normalizeCode(s) {
  const raw = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('JOJO') ? raw.slice(4) : raw;
  return body ? 'JOJO-' + body.match(/.{1,4}/g).join('-') : '';
}
function newCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => abc[b % abc.length]).join('');
  return normalizeCode(chars);
}

function startJoin(role) {
  pendingRole = role;
  $('joinTitle').textContent = role === 'jojo' ? "Setting up JoJo's phone" : 'Join the family';
  $('nameField').hidden = role === 'jojo';
  const invited = new URLSearchParams(location.search).get('family');
  if (invited) {
    document.querySelector('input[name=mode][value=join]').checked = true;
    $('codeInput').value = normalizeCode(invited);
  } else {
    document.querySelector(`input[name=mode][value=${role === 'jojo' ? 'new' : 'join'}]`).checked = true;
  }
  updateJoinMode();
  $('joinError').hidden = true;
  show('join');
}

function updateJoinMode() {
  const join = document.querySelector('input[name=mode]:checked').value === 'join';
  $('codeInput').hidden = !join;
  $('codeHint').textContent = join
    ? 'Ask whoever set up JoJo Reminder for the code (it starts with JOJO-).'
    : "You'll get a code to share with the rest of the family.";
}

async function submitJoin(e) {
  e.preventDefault();
  const err = $('joinError');
  err.hidden = true;
  const name = pendingRole === 'jojo' ? 'JoJo' : $('nameInput').value.trim();
  if (!name) { err.textContent = 'Please type your first name.'; err.hidden = false; return; }
  const joining = document.querySelector('input[name=mode]:checked').value === 'join';
  const code = joining ? normalizeCode($('codeInput').value) : newCode();
  if (joining && code.length < 10) { err.textContent = 'That family code looks too short.'; err.hidden = false; return; }

  const btn = e.submitter || e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const ref = doc(db, 'families', code);
    if (joining) {
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("We couldn't find that family code. Check it and try again.");
    } else {
      await setDoc(ref, { createdAt: serverTimestamp(), createdBy: name });
    }
    store.set('family', code);
    store.set('role', pendingRole);
    store.set('name', name);
    history.replaceState(null, '', '/');
    enterMain();
    if (!joining) toast(`Your family code is ${code}. Share it from ⚙️ Settings.`);
  } catch (ex) {
    err.textContent = ex.message || 'Something went wrong. Please try again.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Main list ---------- */
let reminders = [];
let unsub = null;

function enterMain() {
  show('main');
  $('subtitle').textContent = isJojo() ? 'Your reminders' : `Reminders for JoJo · you're ${me.name}`;
  unsub?.();
  const q = query(remindersCol(), orderBy('dueAt', 'asc'));
  unsub = onSnapshot(q, (snap) => {
    reminders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (e) => {
    console.error(e);
    $('lists').innerHTML = '';
    $('lists').append(el('p', 'error', "Couldn't load reminders. Check your internet connection."));
  });
  refreshNotifyUI();
  syncToken();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  const now = new Date();
  const root = $('lists');
  root.innerHTML = '';
  const active = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done)
    .sort((a, b) => (b.doneAt?.toMillis?.() || 0) - (a.doneAt?.toMillis?.() || 0))
    .slice(0, 15);

  if (active.length === 0) {
    const box = el('div', 'card empty');
    box.append(el('div', 'emoji', '🌼'));
    box.append(el('p', null, isJojo() ? 'Nothing to remember right now!' : 'No reminders yet. Tap “Add reminder” to add one for JoJo.'));
    root.append(box);
  }

  const groups = new Map();
  for (const r of active) {
    const d = r.dueAt.toDate();
    const key = d < now && r.repeat === 'none' ? 'Earlier — not done yet' : dayLabel(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // Overdue first.
  const keys = [...groups.keys()].sort((a, b) => (b.startsWith('Earlier') ? 1 : 0) - (a.startsWith('Earlier') ? 1 : 0));
  for (const k of keys) root.append(group(k, groups.get(k), now));
  if (done.length) root.append(group('Done ✓', done, now));
}

function group(title, items, now) {
  const g = el('section', 'group');
  g.append(el('h3', null, title));
  for (const r of items) g.append(card(r, now));
  return g;
}

function card(r, now) {
  const d = r.dueAt.toDate();
  const overdue = !r.done && d < now && r.repeat === 'none';
  const c = el('article', 'reminder' + (r.done ? ' done' : '') + (overdue ? ' overdue' : ''));
  const check = el('button', 'check', r.done ? '✓' : '');
  check.setAttribute('aria-label', r.done ? 'Mark as not done' : 'Mark as done');
  check.onclick = () => toggleDone(r);
  const body = el('div', 'r-body');
  body.append(el('div', 'r-time', overdue ? whenText(d) : timeFmt.format(d)));
  body.append(el('div', 'r-title', r.title));
  if (r.notes) body.append(el('p', 'r-notes', r.notes));
  const meta = el('p', 'r-meta');
  if (r.repeat && r.repeat !== 'none') meta.append(el('span', null, REPEAT_LABEL[r.repeat]));
  if (r.addedBy) meta.append(el('span', null, `Added by ${r.addedBy}`));
  if (meta.childNodes.length) body.append(meta);
  body.onclick = () => openEditor(r);
  c.append(check, body);
  return c;
}

async function toggleDone(r) {
  const ref = doc(remindersCol(), r.id);
  try {
    if (r.done) {
      const due = r.dueAt.toDate();
      await updateDoc(ref, { done: false, doneAt: null, nextNotifyAt: due > new Date() ? r.dueAt : null });
    } else if (r.repeat && r.repeat !== 'none') {
      const anchor = (r.anchorAt || r.dueAt).toDate();
      const after = new Date(Math.max(Date.now(), r.dueAt.toMillis()));
      const next = nextOccurrence(anchor, r.repeat, after);
      await updateDoc(ref, { dueAt: Timestamp.fromDate(next), nextNotifyAt: Timestamp.fromDate(next), done: false });
      toast(`Nice job! Next time: ${whenText(next)}`);
    } else {
      await updateDoc(ref, { done: true, doneAt: serverTimestamp(), nextNotifyAt: null });
      toast('Nice job! ✓');
    }
  } catch (e) {
    console.error(e);
    toast("Couldn't save. Check your internet connection.");
  }
}

/* ---------- Add / edit ---------- */
let editing = null;

function openEditor(r = null) {
  editing = r;
  $('editTitle').textContent = r ? 'Edit reminder' : (isJojo() ? 'New reminder' : 'New reminder for JoJo');
  $('deleteBtn').hidden = !r;
  $('editWarn').hidden = true;
  const d = r ? r.dueAt.toDate() : roundUp(new Date(Date.now() + 60 * 60000));
  $('fTitle').value = r?.title || '';
  $('fNotes').value = r?.notes || '';
  $('fRepeat').value = r?.repeat || 'none';
  setWhen(d);
  $('editDialog').showModal();
  if (!r) setTimeout(() => $('fTitle').focus(), 50);
}
function roundUp(d) {
  const x = new Date(d);
  x.setSeconds(0, 0);
  x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15);
  return x;
}
function setWhen(d) {
  $('fDate').value = toDateInput(d);
  $('fTime').value = toTimeInput(d);
  checkPast();
}
function readWhen() {
  const [y, m, dd] = $('fDate').value.split('-').map(Number);
  const [hh, mm] = $('fTime').value.split(':').map(Number);
  if (!y || Number.isNaN(hh)) return null;
  return new Date(y, m - 1, dd, hh, mm);
}
function checkPast() {
  const d = readWhen();
  const past = d && d < new Date() && $('fRepeat').value === 'none';
  $('editWarn').textContent = 'That time has already passed — JoJo will be reminded right away.';
  $('editWarn').hidden = !past;
}

function quickTime(kind) {
  const now = new Date();
  let d;
  if (kind === '30m') d = roundUp(new Date(now.getTime() + 30 * 60000));
  if (kind === '1h') d = roundUp(new Date(now.getTime() + 60 * 60000));
  if (kind === 'tomorrow9') { d = startOfDay(new Date(now.getTime() + DAY)); d.setHours(9); }
  if (kind === 'tonight7') { d = startOfDay(now); d.setHours(19); if (d < now) d = new Date(d.getTime() + DAY); }
  setWhen(d);
}

async function saveReminder(e) {
  e.preventDefault();
  const title = $('fTitle').value.trim();
  const when = readWhen();
  if (!title || !when) return;
  let due = when;
  const repeat = $('fRepeat').value;
  // A repeating reminder set in the past starts from its next occurrence.
  if (repeat !== 'none' && due < new Date()) due = nextOccurrence(due, repeat, new Date());

  const data = {
    title,
    notes: $('fNotes').value.trim(),
    repeat,
    dueAt: Timestamp.fromDate(due),
    anchorAt: Timestamp.fromDate(when),
    nextNotifyAt: Timestamp.fromDate(due),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    done: false,
    doneAt: null,
  };
  $('saveBtn').disabled = true;
  try {
    if (editing) {
      await updateDoc(doc(remindersCol(), editing.id), { ...data, updatedBy: me.name, updatedAt: serverTimestamp() });
      toast('Reminder updated.');
    } else {
      await addDoc(remindersCol(), {
        ...data,
        addedBy: me.name,
        addedByDevice: me.deviceId,
        announce: !isJojo(),
        createdAt: serverTimestamp(),
      });
      toast(isJojo() ? 'Reminder added!' : `Added! JoJo will be reminded ${whenText(due)}.`);
    }
    $('editDialog').close();
  } catch (ex) {
    console.error(ex);
    $('editWarn').textContent = "Couldn't save. Check your internet connection and try again.";
    $('editWarn').hidden = false;
  } finally {
    $('saveBtn').disabled = false;
  }
}

async function removeReminder() {
  if (!editing || !confirm(`Delete “${editing.title}”?`)) return;
  await deleteDoc(doc(remindersCol(), editing.id));
  $('editDialog').close();
  toast('Reminder deleted.');
}

/* ---------- Notifications ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushPossible = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
const deviceRef = () => doc(db, 'families', me.family, 'devices', me.deviceId);

let messaging = null;
async function getMessagingSafe() {
  if (messaging) return messaging;
  if (!(await isSupported().catch(() => false))) return null;
  messaging = getMessaging(app);
  onMessage(messaging, async (payload) => {
    const n = payload.notification || {};
    toast(`${n.title || 'Reminder'} ${n.body ? '— ' + n.body : ''}`);
    const reg = await navigator.serviceWorker.getRegistration('/');
    reg?.showNotification(n.title || 'JoJo Reminder', { body: n.body, icon: '/icons/icon-192.png', tag: payload.data?.tag });
  });
  return messaging;
}

async function registerToken() {
  const m = await getMessagingSafe();
  if (!m) throw new Error("This phone's browser can't receive notifications.");
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('No notification token');
  await setDoc(deviceRef(), {
    token, notify: true, name: me.name, role: me.role,
    userAgent: navigator.userAgent.slice(0, 200), updatedAt: serverTimestamp(),
  }, { merge: true });
  store.set('notify', '1');
}

async function enableNotifications() {
  if (isIOS && !isStandalone) { refreshNotifyUI(); return; }
  if (!pushPossible()) { toast("Sorry — this browser can't show notifications."); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are blocked. Turn them on in the phone’s Settings → Notifications.');
    refreshNotifyUI();
    return;
  }
  try {
    await registerToken();
    toast('Notifications are on! 🔔');
  } catch (e) {
    console.error(e);
    toast("Couldn't turn on notifications: " + e.message);
  }
  refreshNotifyUI();
}

/** Keep this phone's token fresh each time the app opens. */
async function syncToken() {
  if (store.get('notify') !== '1' || !pushPossible() || Notification.permission !== 'granted') return;
  try { await registerToken(); } catch (e) { console.warn('Token refresh failed', e); }
}

function notificationsOn() {
  return pushPossible() && Notification.permission === 'granted' && store.get('notify') === '1';
}

function refreshNotifyUI() {
  const needsInstall = isIOS && !isStandalone;
  const on = notificationsOn();
  $('iosBanner').hidden = !(needsInstall && isJojo());
  $('notifyBanner').hidden = !isJojo() || on || needsInstall;
  if (pushPossible() && Notification.permission === 'denied') {
    $('notifyText').innerHTML = '<strong>Notifications are blocked.</strong> Turn them on in the phone’s Settings, then try again.';
  }
  $('sNotify').textContent = needsInstall
    ? 'To get notifications on iPhone, add JoJo Reminder to the Home Screen first (Share ⬆️ → Add to Home Screen).'
    : on ? '🔔 Notifications are on for this phone.' : '🔕 Notifications are off for this phone.';
  $('sNotifyBtn').hidden = on || needsInstall;
}

async function sendTest() {
  const due = new Date(Date.now() + 60000);
  await addDoc(remindersCol(), {
    title: 'Test reminder 🎉', notes: 'If you can see this, JoJo Reminder is working!',
    repeat: 'none', dueAt: Timestamp.fromDate(due), anchorAt: Timestamp.fromDate(due),
    nextNotifyAt: Timestamp.fromDate(due), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    done: false, doneAt: null, addedBy: me.name, addedByDevice: me.deviceId, announce: false,
    createdAt: serverTimestamp(),
  });
  $('settingsDialog').close();
  toast('Test reminder set for 1 minute from now.');
}

/* ---------- Settings ---------- */
function openSettings() {
  $('sCode').textContent = me.family;
  $('sWho').textContent = isJojo() ? "This is JoJo's phone." : `This is ${me.name}'s phone (family).`;
  refreshNotifyUI();
  $('settingsDialog').showModal();
}
async function shareInvite() {
  const url = `${location.origin}/?family=${encodeURIComponent(me.family)}`;
  const text = `Join JoJo Reminder so you can add reminders for JoJo! Open ${url} (family code: ${me.family})`;
  try {
    if (navigator.share) await navigator.share({ title: 'JoJo Reminder', text, url });
    else { await navigator.clipboard.writeText(text); toast('Invite copied — paste it in a text message.'); }
  } catch { /* share cancelled */ }
}
async function leaveFamily() {
  if (!confirm('Remove this phone from the family list? You can rejoin later with the family code.')) return;
  try { await setDoc(deviceRef(), { notify: false, token: null }, { merge: true }); } catch {}
  ['family', 'role', 'name', 'notify'].forEach((k) => store.set(k, null));
  unsub?.();
  $('settingsDialog').close();
  show('welcome');
  $('subtitle').textContent = '';
}

/* ---------- Wire up ---------- */
document.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => startJoin(b.dataset.role); });
document.querySelectorAll('input[name=mode]').forEach((r) => { r.onchange = updateJoinMode; });
$('joinForm').onsubmit = submitJoin;
$('joinBack').onclick = () => show('welcome');
$('addBtn').onclick = () => openEditor();
$('editForm').onsubmit = saveReminder;
$('cancelBtn').onclick = () => $('editDialog').close();
$('deleteBtn').onclick = removeReminder;
$('fDate').onchange = checkPast;
$('fTime').onchange = checkPast;
$('fRepeat').onchange = checkPast;
$('quickTimes').onclick = (e) => { const q = e.target.dataset?.quick; if (q) quickTime(q); };
$('notifyBtn').onclick = enableNotifications;
$('sNotifyBtn').onclick = enableNotifications;
$('testBtn').onclick = sendTest;
$('settingsBtn').onclick = openSettings;
$('shareBtn').onclick = shareInvite;
$('leaveBtn').onclick = leaveFamily;
$('closeSettings').onclick = () => $('settingsDialog').close();
setInterval(() => { if (!$('view-main').hidden) render(); }, 60000); // keep "Today/overdue" fresh

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  if (me.family) enterMain(); else show('welcome');
});
signInAnonymously(auth).catch((e) => {
  console.error(e);
  show('config');
  $('view-config').querySelector('p').textContent =
    "Couldn't sign in. Make sure “Anonymous” sign-in is turned on in Firebase (Authentication → Sign-in method).";
});
