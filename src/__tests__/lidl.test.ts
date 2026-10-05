import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";

// Firebase et les composants navigateur ne servent pas ici : remplacés par des bouchons.
vi.mock("../firebase", () => ({ db: {}, auth: {}, ref: () => ({}), get: async () => ({ val: () => null }), update: async () => {}, onValue: () => () => {}, push: async () => ({ key: "k" }), remove: async () => {}, onAuthStateChanged: () => () => {} }));
vi.mock("../LidlScanner", () => ({ LidlScanner: () => null }));

import { genererXlsxLidl, PRODUCTEURS_LIDL } from "../lidlExport";
import { trierPourPrepa, contexteLidl } from "../LidlCommandes";

const MODELE = resolve(__dirname, "../../public/modeles/lidl-tracabilite-modele.xlsx");
beforeAll(() => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => readFileSync(MODELE) })) as any;
});

const ligne = (i: number, o: any = {}) => ({ id: `x${i}`, date: "2026-10-03", base: "MEA", quantite: 30 + i, transporteur: "SRD", ferme: "SHALIMAR", lot: "L3906", statut: "pret", palettes: 0.5, refLidl: "h250_ke", camion: String(i), depart: "paris", ...o });

describe("tableau de traçabilité Lidl", () => {
  it("part du modèle de Lidl : 5 onglets, onglets annexes inchangés, protection gardée", async () => {
    const r = await genererXlsxLidl("2026-10-03", [ligne(1)], contexteLidl(PRODUCTEURS_LIDL));
    const zip = await JSZip.loadAsync(Buffer.from(r.base64, "base64"));
    const modele = await JSZip.loadAsync(readFileSync(MODELE));
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect((wb.match(/<sheet /g) || []).length).toBe(5);
    for (const f of ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml", "xl/worksheets/sheet5.xml", "xl/styles.xml"])
      expect(await zip.file(f)!.async("string")).toBe(await modele.file(f)!.async("string"));
    const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(s1).toContain("<sheetProtection");
    expect((s1.match(/<x14:dataValidation /g) || []).length).toBe(5);
  });

  it("écrit les valeurs dans les bonnes cases avec le style de la ligne 4 du modèle", async () => {
    const r = await genererXlsxLidl("2026-10-03", [ligne(1)], contexteLidl(PRODUCTEURS_LIDL));
    const zip = await JSZip.loadAsync(Buffer.from(r.base64, "base64"));
    const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const modele = await (await JSZip.loadAsync(readFileSync(MODELE))).file("xl/worksheets/sheet1.xml")!.async("string");
    const styleModele = (c: string) => new RegExp(`<c r="${c}4" s="(\\d+)"`).exec(modele)?.[1];
    expect(new RegExp(`<c r="B4" s="${styleModele("B")}"><v>46298</v>`).test(s1)).toBe(true); // 03/10/2026 en date Excel
    expect(new RegExp(`<c r="E4" s="${styleModele("E")}"><v>19</v>`).test(s1)).toBe(true);   // Meaux = entrepôt 19
    expect(new RegExp(`<c r="Y4" s="${styleModele("Y")}"><v>31</v>`).test(s1)).toBe(true);   // colis
    expect(r.nbLignes).toBe(1);
  });

  it("au-delà de 16 commandes, les lignes absentes du modèle (20 à 31) sont recréées, dans l'ordre", async () => {
    const r = await genererXlsxLidl("2026-10-03", Array.from({ length: 30 }, (_, i) => ligne(i)), contexteLidl(PRODUCTEURS_LIDL));
    const s1 = await (await JSZip.loadAsync(Buffer.from(r.base64, "base64"))).file("xl/worksheets/sheet1.xml")!.async("string");
    const numeros = [...s1.matchAll(/<row r="(\d+)"/g)].map(m => Number(m[1]));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    for (let n = 4; n <= 33; n++) expect(new RegExp(`<row r="${n}"[^>]*><c r="B${n}"[^>]*><v>46298</v>`).test(s1)).toBe(true);
  });

  it("n'exporte pas une ligne pas prête ou sans lot valide", async () => {
    const r = await genererXlsxLidl("2026-10-03", [ligne(1), ligne(2, { statut: "a_preparer" }), ligne(3, { lot: "" })], contexteLidl(PRODUCTEURS_LIDL));
    expect(r.nbLignes).toBe(1);
    expect(r.problemes).toHaveLength(2);
  });
});

describe("ordre de préparation Lidl", () => {
  it("par transporteur (PROVIN CAMANDONA, TRADIF, SRD, MESGUEN, PRIMEVER, puis les autres), puis de la plus petite commande à la plus grosse", () => {
    const ls = [
      { base: "A", transporteur: "PRIMEVER", quantite: 10 }, { base: "B", transporteur: "SRD", quantite: 90 },
      { base: "C", transporteur: "TRADIF", quantite: 70 }, { base: "D", transporteur: "SRD", quantite: 40 },
      { base: "E", transporteur: "PROVIN CAMANDONA", quantite: 50 }, { base: "F", transporteur: "SOCAFNA", quantite: 5 },
      { base: "G", transporteur: "MESGUEN", quantite: 20 },
    ];
    expect(trierPourPrepa(ls).map(l => l.base)).toEqual(["E", "C", "D", "B", "G", "A", "F"]);
  });
});
