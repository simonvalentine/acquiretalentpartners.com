/**
 * Acquire Talent Partners — Email Server
 * Sends real emails via SMTP (Google Workspace)
 *
 * Deploy to Render.com (free tier):
 *   1. Push this repo to GitHub
 *   2. Go to render.com → New → Web Service
 *   3. Connect your GitHub repo
 *   4. Set environment variables in Render dashboard:
 *        SMTP_USER = hello@acquiretalentpartners.com
 *        SMTP_PASS = (your app password)
 *   5. Deploy — it runs 24/7, no local setup needed
 */

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// Allow requests from any origin (your HTML files)
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ═══════════ SMTP CONFIG ═══════════
// Uses environment variables in production (Render)
// Falls back to hardcoded values for local dev
const SMTP_USER = process.env.SMTP_USER || 'hello@acquiretalentpartners.com';
const SMTP_PASS = process.env.SMTP_PASS || 'uvxv jqfd utfm ylon';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

// Verify connection on startup
transporter.verify((err, success) => {
  if (err) {
    console.error('SMTP connection failed:', err.message);
    console.log('\nTroubleshooting:');
    console.log('  1. Check SMTP_USER and SMTP_PASS environment variables');
    console.log('  2. Ensure 2-Step Verification is enabled on the Google account');
    console.log('  3. Check internet connection');
  } else {
    console.log('SMTP connected — ready to send from ' + SMTP_USER);
  }
});

// ═══════════ SEND EMAIL ENDPOINT ═══════════
app.post('/send-email', async (req, res) => {
  const { to, toName, subject, html, templateName } = req.body;

  // Validation
  if (!to || !subject || !html) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: to, subject, html'
    });
  }

  // Build the email
  const mailOptions = {
    from: `"Acquire Talent Partners" <${SMTP_USER}>`,
    to: toName ? `"${toName}" <${to}>` : to,
    subject: subject,
    html: html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    const timestamp = new Date().toISOString();

    console.log(`[${new Date().toLocaleTimeString()}] Email sent -> ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Template: ${templateName || 'Custom'}`);
    console.log(`   Message ID: ${info.messageId}\n`);

    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: timestamp
    });
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ═══════════ HEALTH CHECK ═══════════
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Acquire Talent Partners Email Server',
    sender: SMTP_USER
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Acquire Talent Partners Email Server',
    sender: SMTP_USER
  });
});

// ═══════════ START SERVER ═══════════
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('Acquire Talent Partners — Email Server');
  console.log('Running on port ' + PORT);
  console.log('Sending from: ' + SMTP_USER);
  console.log('');
});
