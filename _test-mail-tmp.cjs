const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: "jordan.jouanest@moorea.fr", pass: "zupv znno urcy qoqy" },
});

transporter.sendMail({
  from: "Jordan Jouanest <jordan.jouanest@moorea.fr>",
  to: "elinathan.sebag@moorea.fr",
  subject: "Test cle Google - Jordan vers Elinathan",
  html: "<p>Test d'envoi depuis la boite de Jordan pour verifier le mot de passe d'application.</p>",
}).then(info => {
  console.log("SUCCES");
  console.log("accepted:", JSON.stringify(info.accepted));
  console.log("rejected:", JSON.stringify(info.rejected));
  console.log("response:", info.response);
}).catch(err => {
  console.log("ECHEC");
  console.log("message:", err.message);
  console.log("code:", err.code);
  console.log("responseCode:", err.responseCode);
});
