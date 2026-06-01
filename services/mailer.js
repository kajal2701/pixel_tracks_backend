import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true, // SSL on 465
  auth: {
    user: process.env.SMTP_USER || "notifications@canstarlights.ca",
    pass: process.env.SMTP_PASS || "tocz azws eune bcvm",
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  family: 4, // force IPv4 — Render doesn't support IPv6 outbound
});

export const sendMail = async ({ to, cc, subject, html }) => {
  const mailOptions = {
    from: '"CanStar Lights" <notifications@canstarlights.ca>',
    to,
    subject,
    html,
  };
  if (cc) mailOptions.cc = cc;
  const info = await transporter.sendMail(mailOptions);
  console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${info.messageId}`);
  return info;
};

export const verifyMailer = () =>
  transporter.verify().then(() => {
    console.log("[MAIL] SMTP connection OK");
    return true;
  });
