// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — sert uniquement à rendre l'app installable et à afficher la coquille
// HTML si le réseau est coupé au démarrage.
//
// Il n'intercepte QUE les navigations. La version précédente s'interposait sur toutes les
// requêtes avec `respondWith(fetch(req).catch(() => caches.match(req)))` : dès que le réseau
// hoquetait, `caches.match` renvoyait `undefined` pour une URL non cachée, et
// `respondWith(undefined)` faisait échouer la requête en dur (net::ERR_FAILED). Les appels
// à /version.json, à l'API et à Firebase Auth tombaient donc en erreur au moindre
// micro-incident réseau — ce qui faisait rater silencieusement la détection de nouvelle
// version et retardait l'affichage du bandeau de rafraîchissement.
// ═══════════════════════════════════════════════════════════════════════════
const CACHE_NAME = 'moorea-agreage-v2';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Le changement de nom de cache purge au passage la coquille mise en cache par l'ancienne
  // version du service worker (qui pouvait pointer vers un bundle JS périmé).
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Tout ce qui n'est pas une navigation part directement au réseau, sans passer par le
  // service worker : API, Firebase, auth, version.json, assets. Ne pas appeler respondWith
  // laisse le navigateur gérer la requête normalement.
  if (req.method !== 'GET' || req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // On rafraîchit la coquille à chaque navigation réussie : sans ça le cache
        // conserverait indéfiniment l'index.html du tout premier chargement, et donc une
        // référence vers un ancien bundle.
        const copie = res.clone();
        caches.open(CACHE_NAME).then(c => c.put('/index.html', copie)).catch(() => {});
        return res;
      })
      .catch(async () => {
        const cached = await caches.match('/index.html');
        return cached || new Response(
          'Application indisponible hors ligne.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      })
  );
});
