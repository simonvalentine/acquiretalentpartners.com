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

// ═══════════ APPLICATION WEBHOOK ═══════════
// Receives application data from the careers site and emails a structured
// notification to the hiring team. This email is then picked up by the
// automated review agent (scheduled task) for candidate assessment.
app.post('/api/application', async (req, res) => {
  const {
    firstName, lastName, email, phone, location, linkedin,
    salary, notice, experience, visa, motivation,
    jobTitle, department, jobTags, jobSalary, jobLocation,
    cvFileName, source
  } = req.body;

  // Validation
  if (!firstName || !lastName || !email || !jobTitle) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: firstName, lastName, email, jobTitle'
    });
  }

  const candidateName = `${firstName} ${lastName}`;
  const appliedDate = new Date().toISOString();

  // Build structured notification email for the review agent to parse
  const notificationHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: #1a1a2e; color: #fff; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">New Application Received</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">${appliedDate}</p>
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h2 style="margin: 0 0 16px; font-size: 16px; color: #1a1a2e;">Role: ${jobTitle}</h2>

        <!-- STRUCTURED DATA BLOCK — parsed by the review agent -->
        <pre style="background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; font-family: monospace;">
---APPLICATION_DATA---
candidate_name: ${candidateName}
candidate_email: ${email}
candidate_phone: ${phone || 'Not provided'}
candidate_location: ${location || 'Not provided'}
candidate_linkedin: ${linkedin || 'Not provided'}
salary_expectation: ${salary || 'Not provided'}
notice_period: ${notice || 'Not provided'}
experience_level: ${experience || 'Not provided'}
right_to_work: ${visa || 'Not provided'}
cv_filename: ${cvFileName || 'Not provided'}
source: ${source || 'Careers Site'}
job_title: ${jobTitle}
job_department: ${department || 'Not specified'}
job_tags: ${jobTags || 'Not specified'}
job_salary_range: ${jobSalary || 'Not specified'}
job_location: ${jobLocation || 'Not specified'}
applied_date: ${appliedDate}
---END_APPLICATION_DATA---
        </pre>

        ${motivation ? `
        <h3 style="margin: 20px 0 8px; font-size: 14px; color: #1a1a2e;">Motivation / Cover Statement</h3>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <pre style="white-space: pre-wrap; font-family: monospace;">---MOTIVATION---
${motivation}
---END_MOTIVATION---</pre>
        </div>
        ` : ''}

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #666;">
          <p>This application will be automatically assessed by the review agent. You'll receive a scorecard shortly.</p>
        </div>
      </div>
    </div>
  `;

  const mailOptions = {
    from: `"Acquire Talent Partners" <${SMTP_USER}>`,
    to: `"Simon Valentine" <simon@simonvalentine.com>`,
    subject: `[New Application] ${jobTitle} — ${candidateName}`,
    html: notificationHtml
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    console.log(`[${new Date().toLocaleTimeString()}] Application received -> ${candidateName}`);
    console.log(`   Role: ${jobTitle}`);
    console.log(`   Email: ${email}`);
    console.log(`   Message ID: ${info.messageId}\n`);

    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: appliedDate
    });
  } catch (err) {
    console.error(`Failed to send application notification for ${candidateName}:`, err.message);
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
