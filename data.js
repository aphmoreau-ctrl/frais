// Couche de données.
// Mode "cloud" : Firebase (connexion + Firestore avec cache hors ligne, synchro entre appareils).
// Mode "local" : tant que firebase-config.js est vide, tout reste dans ce navigateur (pour essayer).
import { firebaseConfig } from './firebase-config.js';

export const MODE = firebaseConfig.apiKey ? 'cloud' : 'local';
export const COLS = ['cfg', 'days', 'obs', 'suivis', 'ruptures', 'notes', 'actions', 'plan', 'meta', 'people', 'fetes', 'carnet', 'retraits'];
export const D = {};
COLS.forEach(c => (D[c] = new Map()));

const FBV = '10.12.2';
let fb = null, uid = null;
const listeners = [];
export const sync = { state: 'ok' };
const pending = {};

export const DEV = (() => {
  try {
    let d = localStorage.getItem('frais_dev');
    if (!d) { d = /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Ordinateur'; d += '-' + Math.random().toString(36).slice(2, 6); localStorage.setItem('frais_dev', d); }
    return d;
  } catch (e) { return 'appareil'; }
})();

export function onChange(f) { listeners.push(f); }
function emit() { listeners.forEach(f => f()); }
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function updateSync() {
  const p = Object.values(pending).some(Boolean);
  sync.state = !navigator.onLine ? 'off' : p ? 'pend' : 'ok';
}
addEventListener('online', () => { updateSync(); emit(); });
addEventListener('offline', () => { updateSync(); emit(); });

// ---------- Démarrage ----------
export async function init() {
  if (MODE === 'local') {
    COLS.forEach(c => {
      try { const a = JSON.parse(localStorage.getItem('frais_col_' + c) || '[]'); D[c] = new Map(a.map(x => [x.id, x])); } catch (e) {}
    });
    updateSync();
    return { user: { email: 'mode essai' } };
  }
  const [A, F, AppM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FBV}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FBV}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${FBV}/firebase-app.js`)
  ]);
  const app = AppM.initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  fb = { A, F, auth, db };
  const user = await new Promise(res => { const u = A.onAuthStateChanged(auth, x => { u(); res(x); }); });
  uid = user ? user.uid : null;
  return { user };
}

export async function login(email, pw) {
  const c = await fb.A.signInWithEmailAndPassword(fb.auth, email, pw);
  uid = c.user.uid;
}
export async function logout() { if (fb) await fb.A.signOut(fb.auth); }

// Écoute en temps réel de toutes les collections (petits volumes, hors photos).
export function subscribe() {
  if (MODE === 'local') return Promise.resolve();
  let first = COLS.length;
  return new Promise(res => {
    COLS.forEach(c => {
      const ref = fb.F.collection(fb.db, 'users', uid, c);
      fb.F.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
        const m = new Map();
        snap.forEach(d => m.set(d.id, { id: d.id, ...d.data() }));
        D[c] = m;
        pending[c] = snap.metadata.hasPendingWrites;
        updateSync();
        if (first > 0) { first--; if (first === 0) res(); } else emit();
      }, err => { console.error(c, err); if (first > 0) { first--; if (first === 0) res(); } });
    });
  });
}

// ---------- Lecture / écriture ----------
export const all = c => [...D[c].values()].filter(x => !x._del);
export const get = (c, id) => { const x = D[c].get(id); return x && !x._del ? x : null; };

function persistLocal(c) {
  try { localStorage.setItem('frais_col_' + c, JSON.stringify([...D[c].values()])); }
  catch (e) { alert('Mémoire du navigateur pleine : en mode essai, supprime des photos ou configure Firebase.'); }
}

// Écriture "champ par champ" : la modification la plus récente l'emporte.
export function put(c, obj) {
  const id = obj.id || newId();
  const data = { ...(D[c].get(id) || {}), ...obj, id, upd: Date.now(), dev: DEV };
  D[c].set(id, data);
  if (MODE === 'local') persistLocal(c);
  else {
    pending[c] = true; updateSync();
    const { id: _i, ...rest } = data;
    fb.F.setDoc(fb.F.doc(fb.db, 'users', uid, c, id), rest, { merge: true }).catch(e => console.error(e));
  }
  emit();
  return data;
}

// Suppression = corbeille 30 jours, puis effacement définitif (purge()).
export function del(c, id) { if (D[c].get(id)) put(c, { id, _del: Date.now() }); }

export function purge() {
  const lim = Date.now() - 30 * 864e5;
  COLS.forEach(c => [...D[c].values()].forEach(x => { if (x._del && x._del < lim) hardDel(c, x.id); }));
}
export function erase(c, id) { hardDel(c, id); emit(); }
function hardDel(c, id) {
  D[c].delete(id);
  if (MODE === 'local') persistLocal(c);
  else fb.F.deleteDoc(fb.F.doc(fb.db, 'users', uid, c, id)).catch(e => console.error(e));
}

// ---------- Photos (collection à part, chargées à la demande) ----------
const photoCache = new Map();
export function putPhoto(dataUrl) {
  const id = 'ph' + newId();
  photoCache.set(id, dataUrl);
  if (MODE === 'local') { try { localStorage.setItem('frais_photo_' + id, dataUrl); } catch (e) { alert('Mémoire pleine en mode essai : photo non enregistrée.'); return null; } }
  else fb.F.setDoc(fb.F.doc(fb.db, 'users', uid, 'photos', id), { d: dataUrl, t: Date.now() }).catch(e => console.error(e));
  return id;
}
export async function getPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  let d = null;
  if (MODE === 'local') d = localStorage.getItem('frais_photo_' + id);
  else { try { const s = await fb.F.getDoc(fb.F.doc(fb.db, 'users', uid, 'photos', id)); d = s.exists() ? s.data().d : null; } catch (e) {} }
  if (d) photoCache.set(id, d);
  return d;
}

// ---------- Sauvegarde / restauration ----------
export async function exportAll() {
  const out = { app: 'rayons-frais', version: 1, date: new Date().toISOString(), data: {}, photos: {} };
  COLS.forEach(c => (out.data[c] = [...D[c].values()]));
  if (MODE === 'local') {
    Object.keys(localStorage).filter(k => k.startsWith('frais_photo_')).forEach(k => (out.photos[k.slice(12)] = localStorage.getItem(k)));
  } else {
    const s = await fb.F.getDocs(fb.F.collection(fb.db, 'users', uid, 'photos'));
    s.forEach(d => (out.photos[d.id] = d.data().d));
  }
  return out;
}
export async function importAll(obj) {
  if (!obj || obj.app !== 'rayons-frais') throw new Error('Ce fichier n\'est pas une sauvegarde de l\'appli.');
  COLS.forEach(c => (obj.data[c] || []).forEach(x => put(c, x)));
  for (const [id, d] of Object.entries(obj.photos || {})) {
    photoCache.set(id, d);
    if (MODE === 'local') { try { localStorage.setItem('frais_photo_' + id, d); } catch (e) {} }
    else await fb.F.setDoc(fb.F.doc(fb.db, 'users', uid, 'photos', id), { d, t: Date.now() });
  }
}
export async function wipeAll() {
  for (const c of COLS) for (const id of [...D[c].keys()]) hardDel(c, id);
  if (MODE === 'local') Object.keys(localStorage).filter(k => k.startsWith('frais_photo_')).forEach(k => localStorage.removeItem(k));
  else { const s = await fb.F.getDocs(fb.F.collection(fb.db, 'users', uid, 'photos')); s.forEach(d => fb.F.deleteDoc(d.ref)); }
  emit();
}
