import { Component, type ReactNode } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — sans ça, la moindre erreur JS non gérée dans le rendu
// (champ manquant, donnée inattendue, etc.) fait disparaître TOUTE l'appli
// et laisse une page blanche, sans aucun indice sur ce qui s'est passé.
// Avec ce filet de sécurité, on affiche un écran clair avec le message
// d'erreur exact (utile pour le diagnostiquer) et un bouton pour recharger.
// ═══════════════════════════════════════════════════════════════════════════

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("Erreur non gérée capturée par ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Syne', sans-serif", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Une erreur est survenue</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", maxWidth: 420, marginBottom: 20, fontFamily: "monospace", wordBreak: "break-word" }}>
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: "10px 24px", borderRadius: 20, border: "none", cursor: "pointer", background: "#c8a84b", color: "#0a0a0a", fontWeight: 700, fontSize: 14, fontFamily: "'Syne', sans-serif" }}
          >
            Recharger l'application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
