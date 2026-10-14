import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, onValue, remove, update, onDisconnect, serverTimestamp, set, get } from "firebase/database";
import { getStorage, ref as refStockage, uploadString, uploadBytes, getDownloadURL } from "firebase/storage";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, signInAnonymously, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCnWg6Y2THauxyM4yk_QqhOcyybU0-WRI4",
  authDomain: "moorea-qualite.firebaseapp.com",
  projectId: "moorea-qualite",
  storageBucket: "moorea-qualite.firebasestorage.app",
  messagingSenderId: "780115511682",
  appId: "1:780115511682:web:027c3f58f2554b2bc6279b",
  databaseURL: "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const stockage = getStorage(app);

// 14/10/2026 — Photos (rapports d'agréage…) stockées dans Firebase Storage : ImgBB (gratuit)
// remplace maintenant les photos affichées hors de son site par une pub « upgrade to Pro ».
// Si Storage n'est pas (encore) activé ou refuse l'envoi, on retombe sur ImgBB via le serveur.
export async function envoyerPhoto(dataUrl: string, dossier = "rapports"): Promise<string> {
  try {
    const m = new Date().toISOString().slice(0, 7);
    const nom = `${dossier}/${m}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const r = refStockage(stockage, nom);
    await uploadString(r, dataUrl, "data_url");
    return await getDownloadURL(r);
  } catch (e) {
    console.warn("Firebase Storage indisponible, envoi ImgBB", e);
  }
  try {
    const res = await fetch("/api/upload-photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl.split(",")[1] }) });
    const data = await res.json();
    return data.url || "";
  } catch { return ""; }
}

// Affichage : les anciennes photos ImgBB passent par notre serveur (api/fetch-image.ts).
export const srcPhoto = (url: string) => /^https:\/\/(i\.)?ibb\.co\//.test(url || "") ? `/api/fetch-image?url=${encodeURIComponent(url)}` : url;

// localStorage — reste connecté, évite le conflit IndexedDB/service worker
setPersistence(auth, browserLocalPersistence);

export const googleProvider = new GoogleAuthProvider();
export { ref, push, onValue, remove, update, set, get, onDisconnect, serverTimestamp, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, createUserWithEmailAndPassword, signInWithEmailAndPassword };

// 14/10/2026 — Recopie d'une photo ImgBB vers Firebase Storage (bouton Réglages › Données).
// Passe par notre serveur (api/fetch-image.ts) : ImgBB ne laisse pas le navigateur lire l'image.
export async function recopierPhotoImgBB(url: string): Promise<string> {
  for (let essai = 0; essai < 3; essai++) {
    try {
      const rep = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`);
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const blob = await rep.blob();
      if (!blob.type.startsWith("image/") || blob.size < 2000) throw new Error("Pas une photo");
      const nom = `rapports/imgbb/${url.split("/").slice(-2).join("-").replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const r = refStockage(stockage, nom);
      await uploadBytes(r, blob, { contentType: blob.type });
      return await getDownloadURL(r);
    } catch (e) {
      if (essai === 2) throw e;
      await new Promise(ok => setTimeout(ok, 1500 * (essai + 1)));
    }
  }
  return "";
}
