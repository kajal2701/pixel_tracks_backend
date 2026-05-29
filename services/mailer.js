import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST || "mail.pixeltracks.ca",
//   port: parseInt(process.env.SMTP_PORT || "465"),
//   secure: true, // TLS on port 587
//   auth: {
//     user: process.env.SMTP_USER || "notification@pixeltracks.ca",
//     pass: process.env.SMTP_PASS || "notification@pixeltracks.ca",
//   },
// });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.pixeltracks.ca",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || "notification@pixeltracks.ca",
    pass: process.env.SMTP_PASS || "notification@pixeltracks.ca",
  },
  family: 4,
  tls: {
    rejectUnauthorized: false,
  },
});


/**
 * Send an email
 */
export const sendMail = async ({ to, cc, subject, html }) => {
  const mailOptions = {
    from: '"Pixel Tracks" <notification@pixeltracks.ca>',
    to,
    subject,
    html,
  };
  if (cc) mailOptions.cc = cc;
  const info = await transporter.sendMail(mailOptions);
  console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${info.messageId}`);
  return info;
};

// Verify SMTP connection
export const verifyMailer = () =>
  transporter.verify().then(() => {
    console.log("[MAIL] SMTP connection OK");
    return true;
  });
