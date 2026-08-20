import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: false, // port 587 uses STARTTLS, not SSL
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

/**
 * Send an email via Brevo SMTP (nodemailer).
 * Signature matches what emailService.js already uses.
 */
export const sendMail = async ({ to, cc, bcc, subject, html, headers = {} }) => {
  const fromName = process.env.SMTP_FROM_NAME || "Pixel Tracks";
  const fromEmail = process.env.SMTP_FROM || "kajalgohil2112@gmail.com";

  const mailOptions = {
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    html,
  };

  if (cc) mailOptions.cc = cc;
  if (bcc) mailOptions.bcc = bcc;
  if (Object.keys(headers).length) mailOptions.headers = headers;

  const info = await transporter.sendMail(mailOptions);
  console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${info.messageId}`);
  return info;
};

/**
 * Verify SMTP connection on startup.
 */
export const verifyMailer = async () => {
  await transporter.verify();
  console.log("[MAIL] Brevo SMTP ready ✅");
  return true;
};