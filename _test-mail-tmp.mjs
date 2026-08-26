import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: "jordan.jouanest@moorea.fr", pass: "zupv znno urcy qoqy" },
});

try {
  const info = await transporter.sendMail({
    from: "Jordan Jouanest <jordan.jouanest@moorea.fr>",
    to: "elinathan.sebag@moorea.fr",
    subject: "Test clé Google - Jordan vers Elinathan",
    html: "<p>Ceci est un test d'envoi depuis la boîte de Jordan (via le mot de passe d'application Google) pour vérifier que la clé fonctionne.</p>",
  });
  console.log("SUCCES");
  console.log("accepted:", JSON.stringify(info.accepted));
  console.log("rejected:", JSON.stringify(info.rejected));
  console.log("response:", info.response);
} catch (err) {
  console.log("ECHEC");
  console.log("message:", err.message);
  console.log("code:", err.code);
  console.log("responseCode:", err.responseCode);
}
