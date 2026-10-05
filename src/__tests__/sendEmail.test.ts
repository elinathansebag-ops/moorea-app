import { describe, it, expect } from "vitest";
// @ts-expect-error — endpoint Vercel en JavaScript
import handler from "../../api/send-email.js";

// Sécurité : aucun mail ne doit partir sans connexion @moorea.fr (jeton Firebase).
const appel = async (headers: Record<string, string>) => {
  const r: any = { code: 0, body: null, setHeader() {}, status(c: number) { r.code = c; return r; }, json(b: any) { r.body = b; return r; }, end() { return r; } };
  await handler({ method: "POST", headers, body: { to: ["x@exemple.fr"], subject: "t", html: "t" } }, r);
  return r;
};

describe("api/send-email", () => {
  it("refuse un envoi sans jeton", async () => { expect((await appel({})).code).toBe(401); });
  it("refuse un jeton invalide", async () => { expect((await appel({ authorization: "Bearer a.b.c" })).code).toBe(401); });
});
