const V='frais-v4.0.0';
const SHELL=['./','./index.html','./app.css','./app.js','./data.js','./seed.js','./firebase-config.js','./zxing-browser.min.js','./manifest.webmanifest','./icon-192.png','./icon-180.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
 if(u.hostname.includes('googleapis.com')&&!u.hostname.includes('fonts'))return; // Firestore/Auth : jamais en cache
 e.respondWith(caches.match(e.request).then(r=>{const net=fetch(e.request).then(res=>{if(res&&(res.ok||res.type==='opaque')){const cl=res.clone();caches.open(V).then(c=>c.put(e.request,cl))}return res}).catch(()=>r);return r||net}))});
