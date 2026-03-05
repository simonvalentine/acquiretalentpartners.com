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

// ═══════════ APPLICATION STORE ═══════════
// In-memory store so both the careers site and ATS can share data.
// On Render free tier the server may restart, clearing this store.
// For persistence, applications are also saved to a JSON file.
const fs = require('fs');
const DATA_FILE = process.env.DATA_DIR
  ? require('path').join(process.env.DATA_DIR, 'applications.json')
  : './applications.json';

let applications = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    applications = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Loaded ${applications.length} applications from ${DATA_FILE}`);
  }
} catch (e) { console.log('No existing application data found, starting fresh.'); }

function saveApplications() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(applications, null, 2)); }
  catch (e) { console.error('Failed to save applications:', e.message); }
}

// GET all applications (used by ATS admin)
app.get('/api/applications', (req, res) => {
  res.json({ success: true, applications });
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

  // ── Store the application in the server ──
  const appId = 'APP-' + Date.now().toString(36).toUpperCase();
  const appRecord = {
    id: appId,
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    location: location || '',
    linkedin: linkedin || '',
    salary: salary || '',
    notice: notice || '',
    experience: experience || '',
    visa: visa || '',
    motivation: motivation || '',
    source: source || 'Careers Site',
    commPreference: req.body.commPreference || ['Email'],
    commDetails: req.body.commDetails || {},
    cvFile: req.body.cvFile || null,
    coverLetterFile: req.body.coverLetterFile || null,
    job: jobTitle || 'General Application',
    department: department || 'General',
    jobTags: jobTags || '',
    jobSalary: jobSalary || '',
    jobLocation: jobLocation || '',
    status: 'new',
    rating: 0,
    appliedDate,
    notes: [],
    timeline: [{ action: 'Applied via ' + (source || 'Careers Site'), date: appliedDate }]
  };
  applications.push(appRecord);
  saveApplications();
  console.log(`[${new Date().toLocaleTimeString()}] Application stored -> ${appId} (${candidateName})`);

  // ── Send notification email (non-blocking) ──
  transporter.sendMail(mailOptions)
    .then(info => {
      console.log(`[${new Date().toLocaleTimeString()}] Notification email sent -> ${candidateName}`);
      console.log(`   Role: ${jobTitle}`);
      console.log(`   Message ID: ${info.messageId}\n`);
    })
    .catch(err => {
      console.error(`Failed to send notification for ${candidateName}:`, err.message);
    });

  // Return immediately with the stored application
  res.json({
    success: true,
    id: appId,
    timestamp: appliedDate
  });
});

// ═══════════ UPDATE APPLICATION ═══════════
// PATCH /api/applications/:id — update status, rating, notes, timeline
app.patch('/api/applications/:id', (req, res) => {
  const app = applications.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

  const { status, rating, notes, timeline, addNote, addTimeline } = req.body;
  if (status !== undefined) app.status = status;
  if (rating !== undefined) app.rating = rating;
  if (notes !== undefined) app.notes = notes;
  if (timeline !== undefined) app.timeline = timeline;
  if (addNote) { app.notes = app.notes || []; app.notes.push(addNote); }
  if (addTimeline) { app.timeline = app.timeline || []; app.timeline.push(addTimeline); }

  saveApplications();
  res.json({ success: true, application: app });
});

// ═══════════ TALENT NETWORK ═══════════
const TN_FILE = process.env.DATA_DIR
  ? require('path').join(process.env.DATA_DIR, 'talent-network.json')
  : './talent-network.json';

let talentNetwork = [];
try {
  if (fs.existsSync(TN_FILE)) {
    talentNetwork = JSON.parse(fs.readFileSync(TN_FILE, 'utf8'));
    console.log(`Loaded ${talentNetwork.length} talent network entries from ${TN_FILE}`);
  }
} catch (e) { console.log('No existing talent network data found, starting fresh.'); }

function saveTalentNetwork() {
  try { fs.writeFileSync(TN_FILE, JSON.stringify(talentNetwork, null, 2)); }
  catch (e) { console.error('Failed to save talent network:', e.message); }
}

app.post('/api/talent-network', (req, res) => {
  const { name, email, profileUrl, departments, roles, locations, resumeFile } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Missing required fields: name, email' });
  }
  const entry = {
    id: 'TN-' + Date.now().toString(36).toUpperCase(),
    name, email, profileUrl: profileUrl || '',
    departments: departments || [], roles: roles || [], locations: locations || [],
    resumeFile: resumeFile || null,
    joinedDate: new Date().toISOString()
  };
  talentNetwork.push(entry);
  saveTalentNetwork();
  console.log(`[${new Date().toLocaleTimeString()}] Talent network signup -> ${name} (${email})`);
  res.json({ success: true, id: entry.id });
});

app.get('/api/talent-network', (req, res) => {
  res.json({ success: true, entries: talentNetwork });
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
