/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// ─── CONFIGURATION EMAIL (Gmail) ───
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "agreage@moorea.fr",
    pass: "ymxz ktzv lele vucp", // App Password Google
  },
});

// ─── CLOUD FUNCTION: ENVOYER EMAIL AVEC RAPPORT ───
exports.sendEmail = functions.https.onCall(async (data, context) => {
  try {
    const { subject, html, cc = [], to = "qualite@moorea.fr" } = data;

    const mailOptions = {
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: Array.isArray(to) ? to.join(",") : to,
      cc: cc.length > 0 ? cc.join(",") : undefined,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("Email error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});
