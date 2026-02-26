/**
 * Acquire Talent Partners — Email Server
 * Sends real emails via SMTP (Google Workspace)
 *
 * SETUP:
 *   1. Install Node.js (nodejs.org)
 *   2. Open a terminal in this folder
 *   3. Run: npm install nodemailer cors express
 *   4. Run: node email-server.js
 *   5. Server starts on http://localhost:3001
 *
 * The ATS panels will automatically connect to this server
 * when you click "Send Email".
 */

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ═══════════ SMTP CONFIG ═══════════
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'hello@acquiretalentpartners.com',
    pass: 'uvxv jqfd utfm ylon'
  }
});

// Verify connection on startup
transporter.verify((err, success) => {
  if (err) {
    console.error('❌ SMTP connection failed:', err.message);
    console.log('\nTroubleshooting:');
    console.log('  1. Check the app password is correct');
    console.log('  2. Ensure 2-Step Verification is enabled on the Google account');
    console.log('  3. Check internet connection');
  } else {
    console.log('✅ SMTP connected — ready to send emails from hello@acquiretalentpartners.com');
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
    from: '"Acquire Talent Partners" <hello@acquiretalentpartners.com>',
    to: toName ? `"${toName}" <${to}>` : to,
    subject: subject,
    html: html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    const timestamp = new Date().toISOString();

    console.log(`✉️  [${new Date().toLocaleTimeString()}] Email sent → ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Template: ${templateName || 'Custom'}`);
    console.log(`   Message ID: ${info.messageId}\n`);

    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: timestamp
    });
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ═══════════ HEALTH CHECK ═══════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Acquire Talent Partners Email Server',
    sender: 'hello@acquiretalentpartners.com'
  });
});

// ═══════════ START SERVER ═══════════
const PORT = 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Acquire Talent Partners — Email Server        ║');
  console.log('║   Running on http://localhost:' + PORT + '               ║');
  console.log('║   Sending from: hello@acquiretalentpartners.com ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Keep this terminal open while using the ATS.');
  console.log('Press Ctrl+C to stop.\n');
});
