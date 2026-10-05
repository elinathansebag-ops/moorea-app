import { describe, it, expect } from "vitest";
import { classifierImportArr, cleDoublonArrivage } from "../arrivagesImport";

// Règles d'import des arrivages Geslot (voir src/arrivagesImport.ts).
const arr = (o: any) => ({ unite: "COLIS", poids_brut: "", poids_net: "", ...o });

describe("import des arrivages", () => {
  it("ignore une ligne déjà importée à l'identique", () => {
    const ex = [arr({ id: "A", produit: "LIME BRESIL CAL. 48", fournisseur: "F", date: "06/10/2026", lot_interne: "7911", quantite: 100, statut: "en attente" })];
    const r = classifierImportArr([arr({ produit: "LIME BRESIL CAL. 48", fournisseur: "F", date: "06/10/2026", lot_interne: "7911", quantite: 100 })], ex);
    expect(r.doublonsExacts).toHaveLength(1);
    expect(r.nouveaux).toHaveLength(0);
  });

  it("met à jour une ligne dont la quantité ou le lot a changé (même article, fournisseur, date)", () => {
    const ex = [arr({ id: "A", produit: "MANGUE KENT", fournisseur: "F", date: "06/10/2026", lot_interne: "7920", quantite: 50, statut: "validé" })];
    const r = classifierImportArr([arr({ produit: "MANGUE KENT", fournisseur: "F", date: "06/10/2026", lot_interne: "7921", quantite: 60 })], ex);
    expect(r.modifs).toHaveLength(1);
    expect(r.modifs[0].ancien.id).toBe("A");
  });

  it("deux livraisons du même article le même jour restent deux arrivages", () => {
    const ex = [arr({ id: "A", produit: "POIS GOURMAND", fournisseur: "F", date: "06/10/2026", lot_interne: "1", quantite: 10, statut: "en attente" })];
    const imp = [
      arr({ produit: "POIS GOURMAND", fournisseur: "F", date: "06/10/2026", lot_interne: "1", quantite: 10 }),
      arr({ produit: "POIS GOURMAND", fournisseur: "F", date: "06/10/2026", lot_interne: "2", quantite: 20 }),
    ];
    const r = classifierImportArr(imp, ex);
    expect(r.doublonsExacts).toHaveLength(1);
    expect(r.nouveaux).toHaveLength(1);
  });

  it("date changée dans Geslot : l'arrivage NON validé est déplacé à la nouvelle date", () => {
    const ex = [arr({ id: "A", produit: "LIME BRESIL CAL. 48", fournisseur: "F", date: "06/10/2026", lot_interne: "7911", quantite: 100, statut: "en attente" })];
    const r = classifierImportArr([arr({ produit: "LIME BRESIL CAL. 48", fournisseur: "F", date: "07/10/2026", lot_interne: "7911", quantite: 100 })], ex);
    expect(r.dateChangee).toHaveLength(1);
    expect(r.dateChangee[0].ancien.id).toBe("A");
    expect(r.nouveaux).toHaveLength(0);
  });

  it("date changée : un arrivage déjà validé n'est jamais déplacé", () => {
    const ex = [arr({ id: "A", produit: "LIME", fournisseur: "F", date: "06/10/2026", lot_interne: "7911", quantite: 100, statut: "validé" })];
    const r = classifierImportArr([arr({ produit: "LIME", fournisseur: "F", date: "07/10/2026", lot_interne: "7911", quantite: 100 })], ex);
    expect(r.dateChangee).toHaveLength(0);
    expect(r.nouveaux).toHaveLength(1);
  });

  it("date changée : sans lot interne, on ne devine pas (nouvel arrivage)", () => {
    const ex = [arr({ id: "A", produit: "AVOCAT", fournisseur: "F", date: "06/10/2026", lot_interne: "", quantite: 30, statut: "en attente" })];
    const r = classifierImportArr([arr({ produit: "AVOCAT", fournisseur: "F", date: "07/10/2026", lot_interne: "", quantite: 30 })], ex);
    expect(r.dateChangee).toHaveLength(0);
    expect(r.nouveaux).toHaveLength(1);
  });

  it("clé de doublon : lot + produit + fournisseur, insensible à la casse", () => {
    expect(cleDoublonArrivage({ lot_interne: "12", produit: "Lime", fournisseur: "Fruitsa" }))
      .toBe(cleDoublonArrivage({ lot_interne: "12", produit: "LIME", fournisseur: "FRUITSA" }));
  });
});
