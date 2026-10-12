import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : « améliore le scan au sol ». Un seul démarrage de caméra
// pour tous les scanners de l'appli (Pointer arrivage, Stock, Lidl, Gencodes) :
//  - image en Full HD (au lieu de 1280×720), avec repli en réglages simples si refusé ;
//  - zone lue = presque toute l'image (au lieu d'un petit carré central de 320 px) : un QR un
//    peu décalé est lu quand même, et le QR garde plus de pixels (html5-qrcode réduit l'image
//    à la taille de la zone avant de la décoder) ;
//  - VRAI zoom de la caméra quand l'appareil le permet (l'ancien curseur ne faisait
//    qu'agrandir l'aperçu à l'écran, la lecture restait sur l'image non zoomée) ;
//  - bip + vibration à chaque lecture réussie.
// ═══════════════════════════════════════════════════════════════════════════

export const FORMATS_PALETTE = [
  Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
];

// Zone de lecture : 90 % de l'aperçu (minimum 50 px, imposé par html5-qrcode).
export const zoneLarge = (largeur: number, hauteur: number) => ({
  width: Math.max(50, Math.floor(largeur * 0.9)),
  height: Math.max(50, Math.floor(hauteur * 0.9)),
});

type OptionsScan = {
  formats?: Html5QrcodeSupportedFormats[] | null; // null = tous les formats de la librairie
  detecteurNatif?: boolean;                        // BarcodeDetector du navigateur (défaut : oui)
  zone?: boolean;                                  // zone de lecture large (défaut : oui) ; false = toute l'image
  surErreur?: (message: string) => void;           // appelé à chaque image sans code
};

const arreterSansErreur = (s: Html5Qrcode) => { try { if (s.isScanning) s.stop().catch(() => {}); } catch { /* déjà arrêté */ } };

// Démarre la caméra arrière dans #idElement. Chaque essai a sa propre instance (relancer
// start() sur une instance qui a échoué bloque html5-qrcode).
export async function demarrerScan(idElement: string, surCode: (texte: string) => void, options: OptionsScan = {}): Promise<Html5Qrcode> {
  deverrouillerSon();
  const formats = options.formats === undefined ? FORMATS_PALETTE : options.formats;
  const config: any = {
    fps: 15,
    disableFlip: false,
    ...(options.zone === false ? {} : { qrbox: zoneLarge }),
    ...(formats ? { formatsToSupport: formats } : {}),
    experimentalFeatures: { useBarCodeDetectorIfSupported: options.detecteurNatif !== false },
  };
  const surErreur = options.surErreur || (() => {});
  const vider = () => { try { document.getElementById(idElement)!.innerHTML = ""; } catch { /* absent */ } };
  const essais: any[] = [
    { facingMode: "environment", focusMode: "continuous", width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    null, // réglages par défaut du navigateur
  ];
  let derniereErreur: any = null;
  for (const contraintes of essais) {
    const s = new Html5Qrcode(idElement, { verbose: false } as any);
    try {
      await s.start({ facingMode: "environment" }, contraintes ? { ...config, videoConstraints: contraintes } : config, surCode, surErreur);
      return s;
    } catch (e: any) {
      derniereErreur = e;
      arreterSansErreur(s);
      // Accès refusé / pas de caméra : inutile de réessayer avec d'autres réglages.
      if (/NotAllowed|Permission|NotFound|Security/i.test(`${e?.name || ""} ${e?.message || e}`)) break;
      vider();
      await new Promise(r => setTimeout(r, 150));
    }
  }
  throw derniereErreur;
}

export { arreterSansErreur as arreterScan };

// ── Vrai zoom de la caméra ──
// Renvoie null si l'appareil ne permet pas de zoomer depuis le navigateur (souvent iPhone/iPad).
export type ZoomCamera = { min: number; max: number; pas: number; valeur: number; appliquer: (v: number) => Promise<void> };
export function zoomCamera(s: Html5Qrcode | null | undefined): ZoomCamera | null {
  try {
    const z = s?.getRunningTrackCameraCapabilities().zoomFeature();
    if (!z || !z.isSupported()) return null;
    const min = z.min(), max = z.max();
    if (!(max > min)) return null;
    return { min, max: Math.min(max, 10), pas: z.step() || 0.1, valeur: z.value() || min, appliquer: v => z.apply(v) };
  } catch {
    return null;
  }
}

// ── Bip + vibration ──
// Safari n'autorise le son qu'après un geste : le contexte audio est créé/réveillé au premier
// toucher sur la page.
let audio: AudioContext | null = null;
function deverrouillerSon() {
  try {
    if (!audio) {
      const C = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!C) return;
      audio = new C();
    }
    if (audio!.state === "suspended") audio!.resume().catch(() => {});
  } catch { /* pas de son */ }
}
if (typeof window !== "undefined") {
  const premierGeste = () => { deverrouillerSon(); window.removeEventListener("pointerdown", premierGeste); window.removeEventListener("touchstart", premierGeste); };
  window.addEventListener("pointerdown", premierGeste, { passive: true });
  window.addEventListener("touchstart", premierGeste, { passive: true });
}

export function bipScan() {
  try { navigator.vibrate?.(80); } catch { /* pas de vibreur */ }
  try {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "sine"; o.frequency.value = 1760;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.13);
  } catch { /* pas de son */ }
}
