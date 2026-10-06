/**
AdTech Script Refactorizado y Completo
Integración de: andyelpro.js + admonetizar.js + pe.js
*/
(function () {
'use strict';

// ============================================================
// ============ PARTE 1: ANDYELPRO.JS (ORIGINAL) ==============
// ============================================================

// ============================================================
 // 1. CONFIGURACIÓN Y CONSTANTES
 // ============================================================
 const CONFIG = {
     ZONE_ID_KEY: '__ZONE_ID_',
     STORAGE_KEY_UUID: 'bf001a61-ea58-4c69-33b4-1b01154b26f5',
     METRIC_TYPE: 'shufflebox',
     EVENTS: {
         LOAD: 'load',
         IMPRESSION: 'impression',
         CLICK: 'click',
         CLOSE: 'close'
     },
     STYLES: {
         HIDDEN_IFRAME: {
             position: 'absolute', left: '-9999px', top: '0', width: '1px',
             height: '1px', border: 'none', opacity: '0', pointerEvents: 'none'
         },
         OVERLAY: {
             position: 'fixed', zIndex: 2147483647, top: 0, left: 0,
             width: '100%', height: '100%', display: 'flex',
             alignItems: 'center', justifyContent: 'center'
         }
     }
 };
 // ============================================================
 // 2. UTILIDADES BÁSICAS
 // ============================================================
 const utils = {
     generateId: () => Math.floor(Math.random() * 100000) + 1,
     now: () => Date.now(),
     isIframe: () => {
         try { return window.self !== window.top; } catch (e) { return true; }
     },
     sendMetric: (url, data) => {
         if (!url) return;
         const payload = JSON.stringify(data);
         if (navigator.sendBeacon) {
             navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
         } else {
             fetch(url, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: payload,
                 keepalive: true
             }).catch(() => {});
         }
     },
     decodeResponse: (text) => {
         try {
             const reversed = text.split('').reverse().join('');
             const decoded = atob(reversed);
             const bytes = new Uint8Array(decoded.length);
             for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
             const finalStr = new TextDecoder('utf-8').decode(bytes).split('').reverse().join('');
             return JSON.parse(finalStr);
         } catch (e) {
             return null;
         }
     }
 };
 // ============================================================
 // 3. GESTIÓN DE ALMACENAMIENTO Y CAPPING (FRECUENCIA)
 // ============================================================
 class StorageManager {
     constructor(key) {
         this.key = JSON.stringify(key);
         this.api = window.localStorage || window.sessionStorage;
     }
     getValue() {
         try { return JSON.parse(this.api.getItem(this.key)); } catch (e) { return null; }
     }
     setValue(data) {
         this.api.setItem(this.key, JSON.stringify(data));
     }
 }
 class FrequencyCapper {
     constructor(settings, metricCallback) {
         this.zoneId = settings.zone_id;
         this.capping = settings.capping ? settings.capping * 1000 : 60000;
         this.frequency = settings.frequency || 1;
         this.interval = settings.interval ? settings.interval * 1000 : 0;
         this.everyPage = settings.every_page;
         this.store = new StorageManager(this.getKey());
         this.metric = metricCallback;
         window.addEventListener('beforeunload', () => this.onBeforeUnload());
     }
     getKey() {
         return this.everyPage ? `${this.zoneId}_${window.location.href.slice(-14)}` : `${this.zoneId}`;
     }
     getState() {
         return this.store.getValue() || { loadedAt: -1, unloadedAt: -1, impressions: [] };
     }
     setState(newState) {
         this.store.setValue({ ...this.getState(), ...newState });
     }
     canShow() {
         const state = this.getState();
         if (state.impressions.length >= this.frequency) {
             return this.capping - (utils.now() - state.impressions[0]);
         }
         const lastImpression = state.impressions[state.impressions.length - 1];
         if (lastImpression) {
             return this.interval - (utils.now() - lastImpression);
         }
         return 0;
     }
     recordImpression() {
         if (this.metric) this.metric(CONFIG.EVENTS.IMPRESSION);
         const state = this.getState();
         this.setState({ impressions: [...state.impressions, utils.now()] });
     }
     onBeforeUnload() {
         this.setState({ unloadedAt: utils.now() });
     }
 }
 // ============================================================
 // 4. OBSERVADOR DE SCROLL Y COMPORTAMIENTO
 // ============================================================
 class ScrollObserver {
     constructor() {
         this.status = 'unknown';
         this.cache = new StorageManager('scroll_status');
         this.init();
         this.onScroll = this.onScroll.bind(this);
     }
     init() {
         const cached = this.cache.getValue();
         if (cached && (utils.now() - Number(cached)) < 1800000) {
             this.status = 'strange';
         }
         setTimeout(() => this.changeStatus('normal'), 10000);
     }
     onScroll() {
         requestAnimationFrame(() => {
             const docHeight = Math.max(
                 document.body.scrollHeight, document.documentElement.scrollHeight,
                 document.body.offsetHeight, document.documentElement.offsetHeight,
                 document.documentElement.clientHeight
             );
             const scrollPercent = Math.round((window.scrollY / (docHeight - window.innerHeight)) * 100);
             if (scrollPercent >= 100) this.changeStatus('maybe strange');
             if (this.status === 'maybe strange' && scrollPercent < 51) {
                 this.changeStatus('strange');
                 this.cache.setValue(utils.now());
             }
         });
     }
     changeStatus(newStatus) {
         const validTransitions = {
             'unknown': ['maybe strange', 'normal'],
             'maybe strange': ['strange', 'normal'],
             'strange': [],
             'normal': []
         };
         if (validTransitions[this.status].includes(newStatus)) {
             this.status = newStatus;
             window.dispatchEvent(new CustomEvent('scrollStatusChange', { detail: this.status }));
         }
         if (validTransitions[this.status].length === 0) {
             window.removeEventListener('scroll', this.onScroll);
         }
     }
     startWatching() {
         window.addEventListener('scroll', this.onScroll, { passive: true });
     }
 }
 // ============================================================
 // 5. INYECCIÓN DE DOM Y IFRAMES
 // ============================================================
 const domUtils = {
     createHiddenIframe: () => {
         const iframe = document.createElement('iframe');
         iframe.src = 'about:blank';
         Object.assign(iframe.style, CONFIG.STYLES.HIDDEN_IFRAME);
         try {
             document.body.appendChild(iframe);
             return iframe;
         } catch (e) {
             document.head.appendChild(iframe);
             return iframe;
         }
     },
     submitFormRedirect: (url, target = '_blank') => {
         const form = document.createElement('form');
         form.action = url;
         form.method = 'GET';
         form.target = target;
         form.style.display = 'none';
         document.body.appendChild(form);
         form.submit();
         document.body.removeChild(form);
     },
     safeOpen: (url) => {
         const hiddenIframe = domUtils.createHiddenIframe();
         if (hiddenIframe && hiddenIframe.contentWindow) {
             return hiddenIframe.contentWindow.open(url, '_blank');
         }
         return window.open(url, '_blank');
     }
 };

// ============================================================
// ============ PARTE 2: ADMONETIZAR.JS (INTEGRADO) ===========
// ============================================================
// ⚠️ AQUÍ ES DONDE METES LAS URLs DE ADSTERRA, EXOCLICK, ETC.
// ============================================================
 const ADMON_SOURCES = [
     'https://URL-EMPRESA-1',
     'https://URL-EMPRESA-2',
     'https://URL-EMPRESA-3',
     'https://URL-EMPRESA-4',
     'https://URL-EMPRESA-5',
     'https://URL-EMPRESA-6',
     'https://URL-EMPRESA-7',
     'https://URL-EMPRESA-8',
     'https://URL-EMPRESA-9',
     'https://URL-EMPRESA-10',
     'https://URL-EMPRESA-11',
     'https://URL-EMPRESA-12',
     'https://URL-EMPRESA-13',
     'https://URL-EMPRESA-14',
     'https://URL-EMPRESA-15',
     'https://URL-EMPRESA-16',
     'https://URL-EMPRESA-17',
     'https://URL-EMPRESA-18',
     'https://URL-EMPRESA-19',
     'https://URL-EMPRESA-20',
     'https://URL-EMPRESA-21',
     'https://URL-EMPRESA-22',
     'https://URL-EMPRESA-23',
     'https://URL-EMPRESA-24',
     'https://URL-EMPRESA-25',
     'https://URL-EMPRESA-26',
     'https://URL-EMPRESA-27',
     'https://URL-EMPRESA-28',
     'https://URL-EMPRESA-29',
     'https://URL-EMPRESA-30',
     'https://URL-EMPRESA-31',
     'https://URL-EMPRESA-32',
     'https://URL-EMPRESA-33',
     'https://URL-EMPRESA-34',
     'https://URL-EMPRESA-35',
     'https://URL-EMPRESA-36',
     'https://URL-EMPRESA-37',
     'https://URL-EMPRESA-38',
     'https://URL-EMPRESA-39',
     'https://URL-EMPRESA-40',
     'https://URL-EMPRESA-41',
     'https://URL-EMPRESA-42',
     'https://URL-EMPRESA-43',
     'https://URL-EMPRESA-44',
     'https://URL-EMPRESA-45',
     'https://URL-EMPRESA-46',
     'https://URL-EMPRESA-47',
     'https://URL-EMPRESA-48',
     'https://URL-EMPRESA-49',
     'https://URL-EMPRESA-50'
 ];
 // =========================================================
 // CONFIGURACIÓN ADMONETIZAR
 // =========================================================
 const ADMON_CONFIG = {
     MIN_INTERVAL: 60000,
     MAX_ADS_PER_MINUTE: 60,
     WINDOW_MS: 60000,
     INITIAL_DELAY: 1500,
     EMBED_SCAN_INTERVAL: 5000,
     LOAD_TIMEOUT: 15000,
     MAX_LOGS: 300,
     EVENTS: true,
     DETECT_EMBEDS: true,
     DETECT_URL_CHANGES: true,
     VISIBILITY: true
 };
 // =========================================================
 // VARIABLES PRINCIPALES ADMONETIZAR
 // =========================================================
 let admon_lastFire = 0;
 let admon_loading = false;
 let admon_providerIndex = 0;
 let admon_totalRequests = 0;
 let admon_successfulLoads = 0;
 let admon_failedLoads = 0;
 let admon_pageLoads = 0;
 let admon_embedLoads = 0;
 let admon_interactionEvents = 0;
 let admon_navigationEvents = 0;
 let admon_lastUrl = location.href;
 const admon_adTimestamps = [];
 const admon_historyLog = [];
 const admon_providerHits = new Array(ADMON_SOURCES.length).fill(0);
 // =========================================================
 // LOG
 // =========================================================
 function admon_registrarLog(tipo, detalle) {
     admon_historyLog.push({
         tiempo: new Date().toISOString(),
         tipo: tipo,
         detalle: detalle,
         url: location.href
     });
     if (admon_historyLog.length > ADMON_CONFIG.MAX_LOGS) {
         admon_historyLog.shift();
     }
 }
 // =========================================================
 // EVENTO PERSONALIZADO
 // =========================================================
 function admon_emitirEvento(nombre, detalle) {
     try {
         window.dispatchEvent(new CustomEvent(nombre, { detail: detalle || {} }));
     } catch (error) {
         console.warn('[Andy.js] No se pudo emitir evento:', nombre);
     }
 }
 // =========================================================
 // OBTENER PROVEEDOR
 // =========================================================
 function admon_nextProvider() {
     if (!ADMON_SOURCES.length) return null;
     const indice = admon_providerIndex;
     admon_providerHits[indice]++;
     const url = ADMON_SOURCES[indice];
     admon_providerIndex = (admon_providerIndex + 1) % ADMON_SOURCES.length;
     return url;
 }
 // =========================================================
 // LIMPIAR TIMESTAMPS
 // =========================================================
 function admon_limpiarTimestamps() {
     const ahora = Date.now();
     while (admon_adTimestamps.length && admon_adTimestamps[0] < ahora - ADMON_CONFIG.WINDOW_MS) {
         admon_adTimestamps.shift();
     }
 }
 // =========================================================
 // CONTROL DE CARGA
 // =========================================================
 function admon_canLoadAd() {
     admon_limpiarTimestamps();
     const ahora = Date.now();
     if (admon_adTimestamps.length >= ADMON_CONFIG.MAX_ADS_PER_MINUTE) {
         admon_registrarLog('BLOQUEO', 'Máximo de anuncios por ventana alcanzado');
         return false;
     }
     if (ahora - admon_lastFire < ADMON_CONFIG.MIN_INTERVAL) return false;
     if (admon_loading) return false;
     return true;
 }
 // =========================================================
 // CREAR URL DE ANUNCIO
 // =========================================================
 function admon_construirAdUrl(url) {
     const separador = url.includes('?') ? '&' : '?';
     return url + separador + '_=' + Date.now() + '&rand=' + Math.random().toString(36).substring(2, 10);
 }
 // =========================================================
 // CARGAR ANUNCIO
 // =========================================================
 function admon_loadAd(motivo) {
     try {
         if (!admon_canLoadAd()) return false;
         const adUrl = admon_nextProvider();
         if (!adUrl) return false;
         admon_loading = true;
         admon_totalRequests++;
         admon_registrarLog('SOLICITUD', motivo || 'manual');
         admon_emitirEvento('andyads:beforeload', { provider: adUrl, motivo: motivo || 'manual' });
         const script = document.createElement('script');
         script.async = true;
         script.src = admon_construirAdUrl(adUrl);
         script.dataset.andyAds = 'true';
         let terminado = false;
         const finalizar = function (exitoso) {
             if (terminado) return;
             terminado = true;
             admon_loading = false;
             if (script.parentNode) script.parentNode.removeChild(script);
             if (exitoso) {
                 admon_lastFire = Date.now();
                 admon_adTimestamps.push(admon_lastFire);
                 admon_successfulLoads++;
                 admon_registrarLog('EXITO', adUrl);
                 admon_emitirEvento('andyads:success', { provider: adUrl });
             } else {
                 admon_failedLoads++;
                 admon_registrarLog('ERROR', adUrl);
                 admon_emitirEvento('andyads:error', { provider: adUrl });
             }
         };
         script.onload = function () {
             finalizar(true);
             console.log('[Andy.js] Anuncio cargado:', adUrl);
         };
         script.onerror = function () {
             finalizar(false);
             console.warn('[Andy.js] Error cargando proveedor:', adUrl);
         };
         document.head.appendChild(script);
         setTimeout(function () {
             if (!terminado) {
                 admon_registrarLog('TIMEOUT', adUrl);
                 finalizar(false);
             }
         }, ADMON_CONFIG.LOAD_TIMEOUT);
         return true;
     } catch (error) {
         admon_loading = false;
         admon_failedLoads++;
         admon_registrarLog('EXCEPCION', error.message);
         console.error('[Andy.js]', error);
         return false;
     }
 }
 // =========================================================
 // DETECCIÓN DE IFRAMES / VIDEO / EMBEDS
 // =========================================================
 function admon_detectEmbeds() {
     if (!ADMON_CONFIG.DETECT_EMBEDS) return;
     const elementos = document.querySelectorAll('iframe, embed, object, video, audio');
     elementos.forEach(function (elemento) {
         if (elemento.dataset.andyTracked) return;
         elemento.dataset.andyTracked = 'true';
         elemento.addEventListener('load', function () {
             admon_embedLoads++;
             admon_registrarLog('EMBED_LOAD', elemento.src || elemento.currentSrc || elemento.data || 'multimedia');
             admon_emitirEvento('andyads:embed', { elemento: elemento });
             admon_loadAd('embed-load');
         });
         elemento.addEventListener('play', function () {
             admon_registrarLog('MEDIA_PLAY', elemento.currentSrc || elemento.src || 'media');
             admon_emitirEvento('andyads:media-play');
             admon_loadAd('media-play');
         });
         elemento.addEventListener('pause', function () {
             admon_emitirEvento('andyads:media-pause');
         });
     });
 }
 // =========================================================
 // OBSERVADOR DEL DOM
 // =========================================================
 let admon_observer = null;
 function admon_iniciarObserver() {
     if (!window.MutationObserver) return;
     admon_observer = new MutationObserver(function (mutations) {
         let huboCambios = false;
         for (const mutation of mutations) {
             if (mutation.addedNodes && mutation.addedNodes.length) {
                 huboCambios = true;
                 break;
             }
         }
         if (huboCambios) admon_detectEmbeds();
     });
     admon_observer.observe(document.documentElement, { childList: true, subtree: true });
 }
 // =========================================================
 // DETECTAR CAMBIOS DE URL
 // =========================================================
 function admon_comprobarUrl() {
     if (!ADMON_CONFIG.DETECT_URL_CHANGES) return;
     const nuevaUrl = location.href;
     if (nuevaUrl === admon_lastUrl) return;
     const anterior = admon_lastUrl;
     admon_lastUrl = nuevaUrl;
     admon_navigationEvents++;
     admon_registrarLog('NAVEGACION', nuevaUrl);
     admon_emitirEvento('andyads:navigation', { anterior: anterior, nueva: nuevaUrl });
     admon_detectEmbeds();
     admon_loadAd('navigation');
 }
 // =========================================================
 // INTERCEPTAR HISTORY API
 // =========================================================
 function admon_interceptarHistory() {
     const pushStateOriginal = history.pushState;
     const replaceStateOriginal = history.replaceState;
     history.pushState = function () {
         const resultado = pushStateOriginal.apply(this, arguments);
         setTimeout(admon_comprobarUrl, 50);
         return resultado;
     };
     history.replaceState = function () {
         const resultado = replaceStateOriginal.apply(this, arguments);
         setTimeout(admon_comprobarUrl, 50);
         return resultado;
     };
     window.addEventListener('popstate', admon_comprobarUrl);
     window.addEventListener('hashchange', admon_comprobarUrl);
 }
 // =========================================================
 // EVENTOS DEL USUARIO
 // =========================================================
 function admon_iniciarEventos() {
     if (!ADMON_CONFIG.EVENTS) return;
     const eventos = ['click', 'touchstart', 'mousedown', 'pointerdown', 'keydown', 'wheel', 'scroll', 'focus'];
     eventos.forEach(function (evento) {
         document.addEventListener(evento, function () {
             admon_interactionEvents++;
             admon_emitirEvento('andyads:interaction', { tipo: evento });
             admon_loadAd('interaction-' + evento);
         }, { passive: true, capture: true });
     });
 }
 // =========================================================
 // VISIBILIDAD DE PÁGINA
 // =========================================================
 function admon_iniciarVisibility() {
     if (!ADMON_CONFIG.VISIBILITY) return;
     document.addEventListener('visibilitychange', function () {
         if (!document.hidden) {
             admon_registrarLog('VISIBILITY', 'Página visible');
             admon_emitirEvento('andyads:visible');
             admon_loadAd('visibility');
         }
     });
 }
 // =========================================================
 // PAGE SHOW / HIDE
 // =========================================================
 window.addEventListener('pageshow', function () {
     admon_pageLoads++;
     admon_registrarLog('PAGESHOW', 'Página restaurada/mostrada');
     admon_loadAd('pageshow');
 });
 window.addEventListener('pagehide', function () {
     admon_emitirEvento('andyads:pagehide');
 });
 // =========================================================
 // REVISIÓN PERIÓDICA DE EMBEDS
 // =========================================================
 let admon_embedInterval = null;
 function admon_iniciarEscaneo() {
     admon_embedInterval = setInterval(function () {
         admon_detectEmbeds();
         admon_comprobarUrl();
     }, ADMON_CONFIG.EMBED_SCAN_INTERVAL);
 }
 // =========================================================
 // API PÚBLICA
 // =========================================================
 window.AndyAds = {
     load: function () { return admon_loadAd('api-manual'); },
     providers: function () { return ADMON_SOURCES.slice(); },
     currentProvider: function () {
         if (!ADMON_SOURCES.length) return null;
         return ADMON_SOURCES[admon_providerIndex];
     },
     count: function () {
         admon_limpiarTimestamps();
         return admon_adTimestamps.length;
     },
     metrics: function () {
         return {
             solicitudesTotales: admon_totalRequests,
             exitosos: admon_successfulLoads,
             fallidos: admon_failedLoads,
             tasaDeExito: admon_totalRequests > 0 ? ((admon_successfulLoads / admon_totalRequests) * 100).toFixed(2) + '%' : '0%',
             hitsPorProveedor: admon_providerHits.slice(),
             indiceActual: admon_providerIndex,
             cargandoActualmente: admon_loading,
             totalFuentesConfiguradas: ADMON_SOURCES.length,
             embedsDetectados: admon_embedLoads,
             interacciones: admon_interactionEvents,
             navegaciones: admon_navigationEvents,
             cargasPagina: admon_pageLoads,
             urlActual: location.href
         };
     },
     logs: function () { return admon_historyLog.slice(); },
     url: function () { return location.href; },
     status: function () {
         return {
             loading: admon_loading,
             ultimoDisparo: admon_lastFire,
             proveedor: this.currentProvider(),
             anunciosVentana: this.count()
         };
     },
     scan: function () { admon_detectEmbeds(); return true; },
     reset: function () {
         admon_adTimestamps.length = 0;
         admon_historyLog.length = 0;
         admon_lastFire = 0;
         admon_loading = false;
         admon_totalRequests = 0;
         admon_successfulLoads = 0;
         admon_failedLoads = 0;
         admon_pageLoads = 0;
         admon_embedLoads = 0;
         admon_interactionEvents = 0;
         admon_navigationEvents = 0;
         admon_providerIndex = 0;
         admon_providerHits.fill(0);
         admon_registrarLog('RESET', 'Sistema reiniciado');
         console.log('[Andy.js] Sistema reiniciado');
     },
     config: function () { return Object.assign({}, ADMON_CONFIG); }
 };
 // =========================================================
 // INICIO ADMONETIZAR
 // =========================================================
 function admon_iniciarAndyAds() {
     console.log('[Andy.js] Inicializando sistema Admonetizar...');
     admon_registrarLog('START', 'AndyAds iniciado');
     admon_iniciarEventos();
     admon_iniciarVisibility();
     admon_interceptarHistory();
     admon_iniciarObserver();
     admon_iniciarEscaneo();
     admon_detectEmbeds();
     setTimeout(function () { admon_loadAd('initial'); }, ADMON_CONFIG.INITIAL_DELAY);
     setInterval(function () { admon_loadAd('interval'); }, ADMON_CONFIG.MIN_INTERVAL);
     admon_emitirEvento('andyads:ready');
     console.log('[Andy.js] Sistema Admonetizar iniciado correctamente.');
 }

// ============================================================
// ============ PARTE 3: PE.JS (ANTI-ADBLOCK) =================
// ============================================================
 const ANTI_ADBLOCK = {
     enabled: true,
     showWarning: true,
     warningId: 'andy-adblock-warning',
     probeTimeout: 7000,
     maxProvidersPerCheck: 3,
     retryDelay: 2500,
     maxRetries: 3,
     checkInterval: 120000,
     initialCheckDelay: 2500,
     cooldownWarning: 30000,
     title: 'Anuncios bloqueados o no disponibles',
     message: 'Parece que un bloqueador de anuncios o una extensión de privacidad está impidiendo cargar los anuncios. Si quieres apoyar este sitio, puedes desactivarlo para este dominio y recargar la página.'
 };
 let adBlockDetected = false;
 let adBlockChecking = false;
 let adBlockChecks = 0;
 let adBlockFailures = 0;
 let adBlockSuccesses = 0;
 let adBlockRetries = 0;
 let adBlockLastCheck = 0;
 let adBlockLastFailure = 0;
 let adBlockLastSuccess = 0;
 let adBlockWarningTime = 0;
 let adBlockTimer = null;
 function emitirEstadoAdBlock(estado, detalle) {
     admon_emitirEvento('andyads:adblock', {
         estado: estado, detalle: detalle || '', detected: adBlockDetected,
         checks: adBlockChecks, failures: adBlockFailures, successes: adBlockSuccesses,
         retries: adBlockRetries, timestamp: Date.now(), url: location.href
     });
 }
 function registrarAdBlock(tipo, detalle) {
     admon_registrarLog(tipo, detalle || '');
 }
 function ocultarAvisoAdBlock() {
     const aviso = document.getElementById(ANTI_ADBLOCK.warningId);
     if (aviso) aviso.remove();
 }
 function mostrarAvisoAdBlock() {
     if (!ANTI_ADBLOCK.enabled || !ANTI_ADBLOCK.showWarning) return;
     const ahora = Date.now();
     if (ahora - adBlockWarningTime < ANTI_ADBLOCK.cooldownWarning) return;
     adBlockWarningTime = ahora;
     if (document.getElementById(ANTI_ADBLOCK.warningId)) return;
     const aviso = document.createElement('div');
     aviso.id = ANTI_ADBLOCK.warningId;
     aviso.style.cssText = 'position:fixed;left:20px;right:20px;bottom:20px;z-index:2147483647;max-width:650px;margin:0 auto;padding:16px 18px;background:#181818;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:12px;box-shadow:0 10px 35px rgba(0,0,0,.45);font-family:Arial,sans-serif;font-size:14px;line-height:1.5;';
     aviso.innerHTML = '<div style="display:flex;align-items:flex-start;gap:12px;"><div style="flex:1;"><div style="font-weight:700;font-size:16px;margin-bottom:6px;">' + ANTI_ADBLOCK.title + '</div><div style="opacity:.88;">' + ANTI_ADBLOCK.message + '</div></div><button type="button" data-andy-adblock-close="true" style="border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer;padding:0 4px;">&times;</button></div>';
     const cerrar = aviso.querySelector('[data-andy-adblock-close]');
     if (cerrar) {
         cerrar.addEventListener('click', function () {
             ocultarAvisoAdBlock();
             registrarAdBlock('ADBLOCK_WARNING_CLOSED', 'Usuario cerró el aviso');
         });
     }
     if (document.body) document.body.appendChild(aviso);
 }
 function marcarAdBlockDetectado(motivo) {
     adBlockDetected = true;
     adBlockFailures++;
     adBlockLastFailure = Date.now();
     registrarAdBlock('ADBLOCK_DETECTED', motivo || 'Posible bloqueo de anuncios');
     emitirEstadoAdBlock('detected', motivo || '');
     mostrarAvisoAdBlock();
 }
 function marcarAdBlockNormal(detalle) {
     const antes = adBlockDetected;
     adBlockDetected = false;
     adBlockSuccesses++;
     adBlockLastSuccess = Date.now();
     if (antes) registrarAdBlock('ADBLOCK_RECOVERED', detalle || 'Los anuncios volvieron a responder');
     ocultarAvisoAdBlock();
     emitirEstadoAdBlock('normal', detalle || '');
 }
 function comprobarProveedorPublicidad(url) {
     return new Promise(function (resolve) {
         if (!url) { resolve(false); return; }
         let terminado = false;
         const script = document.createElement('script');
         const finalizar = function (resultado) {
             if (terminado) return;
             terminado = true;
             if (script.parentNode) script.parentNode.removeChild(script);
             resolve(resultado);
         };
         script.async = true;
         script.dataset.andyAdBlockProbe = 'true';
         script.src = admon_construirAdUrl(url);
         script.onload = function () { finalizar(true); };
         script.onerror = function () { finalizar(false); };
         try { document.head.appendChild(script); } catch (error) { finalizar(false); return; }
         setTimeout(function () { finalizar(false); }, ANTI_ADBLOCK.probeTimeout);
     });
 }
 function obtenerProveedoresParaPrueba() {
     if (!ADMON_SOURCES.length) return [];
     const cantidad = Math.min(ANTI_ADBLOCK.maxProvidersPerCheck, ADMON_SOURCES.length);
     const resultado = [];
     let indice = admon_providerIndex;
     for (let i = 0; i < cantidad; i++) {
         resultado.push(ADMON_SOURCES[indice]);
         indice = (indice + 1) % ADMON_SOURCES.length;
     }
     return resultado;
 }
 async function comprobarPublicidad() {
     if (!ANTI_ADBLOCK.enabled) return false;
     if (adBlockChecking) return false;
     adBlockChecking = true;
     adBlockChecks++;
     adBlockLastCheck = Date.now();
     registrarAdBlock('ADBLOCK_CHECK', 'Iniciando comprobación');
     const proveedores = obtenerProveedoresParaPrueba();
     if (!proveedores.length) { adBlockChecking = false; return false; }
     let algunoFunciono = false;
     try {
         for (let i = 0; i < proveedores.length; i++) {
             const proveedor = proveedores[i];
             registrarAdBlock('ADBLOCK_PROBE', proveedor);
             const resultado = await comprobarProveedorPublicidad(proveedor);
             if (resultado) {
                 algunoFunciono = true;
                 registrarAdBlock('ADBLOCK_PROBE_OK', proveedor);
                 break;
             }
             registrarAdBlock('ADBLOCK_PROBE_FAIL', proveedor);
         }
         if (algunoFunciono) marcarAdBlockNormal('Al menos un proveedor respondió correctamente');
         else marcarAdBlockDetectado('Ninguno de los proveedores comprobados respondió');
         return algunoFunciono;
     } catch (error) {
         registrarAdBlock('ADBLOCK_EXCEPTION', error.message);
         marcarAdBlockDetectado('Error durante la comprobación');
         return false;
     } finally { adBlockChecking = false; }
 }
 function programarReintentoAdBlock() {
     if (adBlockRetries >= ANTI_ADBLOCK.maxRetries) return;
     adBlockRetries++;
     registrarAdBlock('ADBLOCK_RETRY', 'Reintento ' + adBlockRetries);
     setTimeout(function () { comprobarPublicidad(); }, ANTI_ADBLOCK.retryDelay);
 }
 function iniciarProteccionAdBlock() {
     if (!ANTI_ADBLOCK.enabled) return;
     setTimeout(function () { comprobarPublicidad(); }, ANTI_ADBLOCK.initialCheckDelay);
     document.addEventListener('visibilitychange', function () {
         if (document.visibilityState === 'visible') comprobarPublicidad();
     });
     window.addEventListener('pageshow', function () { comprobarPublicidad(); });
     adBlockTimer = setInterval(function () { comprobarPublicidad(); }, ANTI_ADBLOCK.checkInterval);
     registrarAdBlock('ADBLOCK_STARTED', 'Protección Anti-AdBlock iniciada');
 }
 function estadoAdBlockPublico() {
     return {
         enabled: ANTI_ADBLOCK.enabled, detected: adBlockDetected, checking: adBlockChecking,
         checks: adBlockChecks, failures: adBlockFailures, successes: adBlockSuccesses,
         retries: adBlockRetries, lastCheck: adBlockLastCheck, lastFailure: adBlockLastFailure,
         lastSuccess: adBlockLastSuccess
     };
 }
 window.AndyAds.adblockStatus = estadoAdBlockPublico;

// ============================================================
// ============ INICIALIZACIÓN FINAL ==========================
// ============================================================

 // ============================================================
 // 6. LÓGICA PRINCIPAL DE CARGA DE ANUNCIOS (andyelpro original)
 // ============================================================
 async function initializeAdTech() {
     try {
         const rawConfig = '{"zone_id":123456,"url":"https://example.com/ad","capping":60,"frequency":1,"interval":0,"every_page":false,"close_add_url":"","close_add_capping":0,"close_add_clicks":0}';
         const settings = JSON.parse(rawConfig);
         const zoneKey = `${CONFIG.ZONE_ID_KEY}${settings.zone_id}`;
         if (window[zoneKey]) {
             console.warn('Doble tag detectado para zone_id:', settings.zone_id);
             return;
         }
         window[zoneKey] = true;
         const metric = (event, extraData = {}) => {
             if (settings.metric_url) {
                 utils.sendMetric(settings.metric_url, {
                     event, type: CONFIG.METRIC_TYPE, zone_id: settings.zone_id, ...extraData
                 });
             }
         };
         const capper = new FrequencyCapper(settings, metric);
         const scrollObs = new ScrollObserver();
         scrollObs.startWatching();
         const renderAd = async () => {
             const waitTime = capper.canShow();
             if (waitTime > 0) { setTimeout(renderAd, waitTime); return; }
             try {
                 const response = await fetch(settings.url);
                 const text = await response.text();
                 const creatives = utils.decodeResponse(text);
                 if (!creatives || creatives.length === 0) { metric('no_fill'); return; }
                 capper.recordImpression();
                 metric(CONFIG.EVENTS.LOAD);
                 creatives.forEach(creative => {
                     const container = document.createElement('div');
                     Object.assign(container.style, CONFIG.STYLES.OVERLAY);
                     container.innerHTML = creative.html;
                     container.querySelectorAll('[data-onClose="0"]').forEach(btn => {
                         btn.addEventListener('click', () => {
                             container.remove();
                             metric(CONFIG.EVENTS.CLOSE);
                         });
                     });
                     container.querySelectorAll('[data-onOpen="0"]').forEach(btn => {
                         btn.addEventListener('click', (e) => {
                             e.preventDefault();
                             if (creative.click_trackers) {
                                 creative.click_trackers.forEach(tracker => {
                                     fetch(tracker, { mode: 'no-cors' }).catch(() => {});
                                 });
                             }
                             domUtils.safeOpen(creative.url);
                             metric(CONFIG.EVENTS.CLICK);
                         });
                     });
                     document.body.appendChild(container);
                 });
             } catch (error) {
                 metric('creative_loading_failed', { stack: error.message });
             }
         };
         if (settings.delay > 0) setTimeout(renderAd, settings.delay * 1000);
         else renderAd();
     } catch (error) {
         console.error('Error crítico en AdTech Script:', error);
     }
 }

 // ============================================================
 // 7. INICIALIZACIÓN SEGURA (TODO JUNTO)
 // ============================================================
 function iniciarTodo() {
     // 1) Iniciar Admonetizar (sistema de 50 proveedores)
     admon_iniciarAndyAds();
     
     // 2) Iniciar Anti-AdBlock
     iniciarProteccionAdBlock();
     
     // 3) Iniciar el sistema original andyelpro
     initializeAdTech();
 }

 if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', iniciarTodo);
 } else {
     iniciarTodo();
 }
})();
