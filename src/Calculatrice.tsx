import { useEffect, useRef, useState } from "react";

// 30/09/2026 — Demande d'Elinathan : la même calculatrice que dans Stock, aussi dans Arrivage.
// Bouton 🧮 flottant en bas à droite ; « ↑ Utiliser » met le résultat dans la dernière case
// numérique cliquée (colis, palettes…), comme dans Stock.
export function Calculatrice() {
  const [ouverte, setOuverte] = useState(false);
  const [expr, setExpr] = useState("");
  const [courant, setCourant] = useState("0");
  const [vientDEvaluer, setVientDEvaluer] = useState(false);
  const dernierChamp = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.type === "number" && !el.closest("[data-calculatrice]")) dernierChamp.current = el;
    };
    document.addEventListener("focusin", onFocus, true);
    return () => document.removeEventListener("focusin", onFocus, true);
  }, []);

  const num = (n: string) => {
    if (vientDEvaluer) { setCourant(n); setVientDEvaluer(false); return; }
    setCourant(c => (c === "0" ? n : c + n));
  };
  const op = (o: string) => { setVientDEvaluer(false); setExpr(e => e + courant + " " + o + " "); setCourant("0"); };
  const egal = () => {
    const full = expr + courant;
    if (!/^[\d\s+\-*/.]+$/.test(full)) { setCourant("0"); setExpr(""); return; }
    try {
      // eslint-disable-next-line no-new-func
      const r = Math.round(Function('"use strict";return (' + full + ")")() * 100) / 100;
      setExpr(full + " =");
      setCourant(String(r));
      setVientDEvaluer(true);
    } catch { setCourant("0"); setExpr(""); }
  };
  const effacer = () => { setCourant("0"); setExpr(""); setVientDEvaluer(false); };
  const retour = () => { if (vientDEvaluer) { setCourant("0"); setVientDEvaluer(false); } else setCourant(c => (c.length > 1 ? c.slice(0, -1) : "0")); };
  const utiliser = () => {
    const el = dernierChamp.current;
    if (el && document.body.contains(el)) {
      // Setter natif : nécessaire pour que React voie le changement sur un champ contrôlé.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, courant);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOuverte(false);
  };

  const b = (label: string, onClick: () => void, style: React.CSSProperties = {}) => (
    <button type="button" onClick={onClick} style={{ padding: "9px 0", border: "1.5px solid #e8e0d0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, ...style }}>{label}</button>
  );
  const opStyle = { color: "#c8a84b", fontWeight: 800 };

  return (
    <div data-calculatrice>
      <button type="button" onClick={() => setOuverte(o => !o)} title="Calculatrice"
        style={{ position: "fixed", bottom: 96, right: 28, width: 50, height: 50, background: "#c8a84b", border: "none", borderRadius: "50%", cursor: "pointer", fontSize: 20, boxShadow: "0 4px 16px rgba(200,168,75,.4)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
        🧮
      </button>
      {ouverte && (
        <div style={{ position: "fixed", bottom: 156, right: 24, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 18, padding: 16, width: 236, boxShadow: "0 8px 32px rgba(0,0,0,.15)", zIndex: 500 }}>
          <div style={{ background: "#f5f3ee", border: "1.5px solid #e8e0d0", borderRadius: 10, padding: "8px 12px", textAlign: "right", marginBottom: 10, minHeight: 50 }}>
            <div style={{ fontSize: 11, color: "#6b7280", minHeight: 14 }}>{expr}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{courant}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
            {b("C", effacer, { color: "#dc2626" })}{b("⌫", retour, opStyle)}{b("+", () => op("+"), opStyle)}{b("−", () => op("-"), opStyle)}
            {b("7", () => num("7"))}{b("8", () => num("8"))}{b("9", () => num("9"))}{b("×", () => op("*"), opStyle)}
            {b("4", () => num("4"))}{b("5", () => num("5"))}{b("6", () => num("6"))}{b("=", egal, { background: "#c8a84b", borderColor: "#c8a84b", fontWeight: 800 })}
            {b("1", () => num("1"))}{b("2", () => num("2"))}{b("3", () => num("3"))}{b("0", () => num("0"))}
            {b("↑ Utiliser", utiliser, { gridColumn: "span 4", background: "#0a0a0a", color: "#fff", borderColor: "#0a0a0a", fontSize: 12 })}
          </div>
        </div>
      )}
    </div>
  );
}
