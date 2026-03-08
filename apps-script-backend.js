/**
 * ═══════════════════════════════════════════════════════════════════
 * Acquire Talent Partners — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════════════════
 *
 * REPLACES the Render email server. Stores all data in Google Sheets
 * and sends emails via Google Workspace.
 *
 * SETUP:
 *   1. Go to https://script.google.com → New Project
 *   2. Name it "ATP Backend"
 *   3. Paste this entire file into Code.gs (replace the default code)
 *   4. Click Run → run the "setup" function once (it creates the Sheet)
 *   5. Deploy → New Deployment → Web App
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   6. Copy the Web App URL — paste it into index.html and ats-admin.html
 *
 * ENDPOINTS (all via the single Web App URL):
 *   GET  ?action=getApplications         → returns all applications
 *   GET  ?action=getTalentNetwork         → returns all talent network entries
 *   GET  ?action=getApplication&id=X      → returns one application
 *   POST {action:"submitApplication",...} → stores application + sends notification + auto-scores
 *   POST {action:"updateApplication",...} → updates status/rating/notes
 *   POST {action:"submitTalentNetwork",...} → stores talent network signup
 *   POST {action:"sendEmail",...}         → sends an email (for ATS templates)
 *   POST {action:"scoreApplication", id:X} → scores/re-scores a candidate against the job advert
 */

// ═══════════ CONFIG ═══════════
const SPREADSHEET_NAME = 'ATP ATS Database';
const NOTIFICATION_EMAIL = 'simon@simonvalentine.com';
const SENDER_NAME = 'Acquire Talent Partners';

// ═══════════ SETUP (run once) ═══════════
function setup() {
  let ss = getOrCreateSpreadsheet();
  Logger.log('Spreadsheet ready: ' + ss.getUrl());
  Logger.log('Share this URL with your team if needed.');
}

function getOrCreateSpreadsheet() {
  // Look for existing spreadsheet
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }

  // Create new spreadsheet
  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);

  // Applications sheet
  let sheet = ss.getSheetByName('Sheet1');
  sheet.setName('Applications');
  sheet.getRange(1, 1, 1, 26).setValues([[
    'id', 'firstName', 'lastName', 'email', 'phone', 'location',
    'linkedin', 'salary', 'notice', 'experience', 'visa',
    'motivation', 'source', 'job', 'department',
    'jobTags', 'jobSalary', 'jobLocation',
    'status', 'rating', 'aiRating', 'appliedDate',
    'notes', 'timeline', 'commPreference', 'commDetails'
  ]]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 26).setFontWeight('bold');

  // Talent Network sheet
  const tnSheet = ss.insertSheet('Talent Network');
  tnSheet.getRange(1, 1, 1, 9).setValues([[
    'id', 'name', 'email', 'profileUrl',
    'departments', 'roles', 'locations',
    'joinedDate', 'resumeFileName'
  ]]);
  tnSheet.setFrozenRows(1);
  tnSheet.getRange(1, 1, 1, 9).setFontWeight('bold');

  Logger.log('Created spreadsheet: ' + ss.getUrl());
  return ss;
}

// ═══════════ WEB APP HANDLERS ═══════════

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';

  let result;
  switch (action) {
    case 'getApplications':
      result = getAllApplications();
      break;
    case 'getTalentNetwork':
      result = getAllTalentNetwork();
      break;
    case 'getApplication':
      result = getApplicationById(e.parameter.id);
      break;
    default:
      result = { success: true, status: 'ok', service: 'ATP Backend (Google Apps Script)' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON: ' + err.message });
  }

  const action = data.action || '';

  let result;
  switch (action) {
    case 'submitApplication':
      result = submitApplication(data);
      break;
    case 'updateApplication':
      result = updateApplication(data);
      break;
    case 'submitTalentNetwork':
      result = submitTalentNetwork(data);
      break;
    case 'sendEmail':
      result = sendEmail(data);
      break;
    case 'scoreApplication':
      result = scoreApplication(data);
      break;
    default:
      result = { success: false, error: 'Unknown action: ' + action };
  }

  return jsonResponse(result);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════ APPLICATIONS ═══════════

function getAllApplications() {
  const sheet = getSheet('Applications');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, applications: [] };

  const headers = data[0];
  const applications = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const app = {};
    headers.forEach((h, j) => {
      const val = row[j];
      // Parse JSON fields
      if (['notes', 'timeline', 'commPreference', 'commDetails'].includes(h)) {
        try { app[h] = typeof val === 'string' && val ? JSON.parse(val) : (val || (h === 'commPreference' ? ['Email'] : (h === 'commDetails' ? {} : []))); }
        catch (e) { app[h] = h === 'commPreference' ? ['Email'] : (h === 'commDetails' ? {} : []); }
      } else if (h === 'rating' || h === 'aiRating') {
        app[h] = Number(val) || 0;
      } else {
        app[h] = val !== undefined && val !== null ? String(val) : '';
      }
    });
    applications.push(app);
  }

  return { success: true, applications };
}

function getApplicationById(id) {
  if (!id) return { success: false, error: 'Missing id parameter' };
  const all = getAllApplications();
  const app = all.applications.find(a => a.id === id);
  if (!app) return { success: false, error: 'Application not found' };
  return { success: true, application: app };
}

function submitApplication(data) {
  const { firstName, lastName, email, jobTitle } = data;

  if (!firstName || !lastName || !email || !jobTitle) {
    return { success: false, error: 'Missing required fields: firstName, lastName, email, jobTitle' };
  }

  const sheet = getSheet('Applications');
  const appId = 'APP-' + new Date().getTime().toString(36).toUpperCase();
  const appliedDate = new Date().toISOString();
  const source = data.source || 'Careers Site';

  const notes = JSON.stringify([]);
  const timeline = JSON.stringify([{ action: 'Applied via ' + source, date: appliedDate }]);
  const commPref = JSON.stringify(data.commPreference || ['Email']);
  const commDet = JSON.stringify(data.commDetails || {});

  sheet.appendRow([
    appId,
    firstName,
    lastName,
    email,
    data.phone || '',
    data.location || '',
    data.linkedin || '',
    data.salary || '',
    data.notice || '',
    data.experience || '',
    data.visa || '',
    data.motivation || '',
    source,
    jobTitle,
    data.department || 'General',
    data.jobTags || '',
    data.jobSalary || '',
    data.jobLocation || '',
    'new',
    0,       // rating (human score — set manually in ATS)
    0,       // aiRating (auto-scored below)
    appliedDate,
    notes,
    timeline,
    commPref,
    commDet
  ]);

  // Send notification email
  try {
    const candidateName = firstName + ' ' + lastName;
    const subject = '[New Application] ' + jobTitle + ' — ' + candidateName;
    const htmlBody = buildNotificationEmail(data, appId, appliedDate);
    GmailApp.sendEmail(NOTIFICATION_EMAIL, subject, '', {
      htmlBody: htmlBody,
      name: SENDER_NAME
    });
  } catch (err) {
    Logger.log('Email notification failed: ' + err.message);
  }

  // ── AUTO-SCORE: run AI scoring immediately after saving ──
  let scorecardResult = null;
  try {
    scorecardResult = scoreApplication({ id: appId });
  } catch (err) {
    Logger.log('Auto-scoring failed: ' + err.message);
  }

  return { success: true, id: appId, timestamp: appliedDate, scorecard: scorecardResult ? scorecardResult.scorecard : null };
}

function updateApplication(data) {
  const { id } = data;
  if (!id) return { success: false, error: 'Missing application id' };

  const sheet = getSheet('Applications');
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idCol = headers.indexOf('id');

  // Find the row
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idCol] === id) { rowIndex = i + 1; break; } // +1 for 1-based row
  }

  if (rowIndex === -1) return { success: false, error: 'Application not found: ' + id };

  // Update fields
  if (data.status !== undefined) {
    const col = headers.indexOf('status') + 1;
    sheet.getRange(rowIndex, col).setValue(data.status);
  }
  if (data.rating !== undefined) {
    const col = headers.indexOf('rating') + 1;
    sheet.getRange(rowIndex, col).setValue(data.rating);
  }
  if (data.notes !== undefined) {
    const col = headers.indexOf('notes') + 1;
    sheet.getRange(rowIndex, col).setValue(JSON.stringify(data.notes));
  }
  if (data.timeline !== undefined) {
    const col = headers.indexOf('timeline') + 1;
    sheet.getRange(rowIndex, col).setValue(JSON.stringify(data.timeline));
  }

  return { success: true, id: id };
}

// ═══════════ TALENT NETWORK ═══════════

function getAllTalentNetwork() {
  const sheet = getSheet('Talent Network');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, entries: [] };

  const headers = data[0];
  const entries = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const entry = {};
    headers.forEach((h, j) => {
      const val = row[j];
      if (['departments', 'roles', 'locations'].includes(h)) {
        try { entry[h] = typeof val === 'string' && val ? JSON.parse(val) : []; }
        catch (e) { entry[h] = []; }
      } else {
        entry[h] = val !== undefined && val !== null ? String(val) : '';
      }
    });
    entries.push(entry);
  }

  return { success: true, entries };
}

function submitTalentNetwork(data) {
  const { name, email } = data;
  if (!name || !email) {
    return { success: false, error: 'Missing required fields: name, email' };
  }

  const sheet = getSheet('Talent Network');
  const entryId = 'TN-' + new Date().getTime().toString(36).toUpperCase();

  sheet.appendRow([
    entryId,
    name,
    email,
    data.profileUrl || '',
    JSON.stringify(data.departments || []),
    JSON.stringify(data.roles || []),
    JSON.stringify(data.locations || []),
    new Date().toISOString(),
    data.resumeFileName || ''
  ]);

  return { success: true, id: entryId };
}

// ═══════════ SEND EMAIL ═══════════

function sendEmail(data) {
  const { to, subject, html } = data;
  if (!to || !subject || !html) {
    return { success: false, error: 'Missing required fields: to, subject, html' };
  }

  try {
    GmailApp.sendEmail(to, subject, '', {
      htmlBody: html,
      name: data.fromName || SENDER_NAME
    });
    return { success: true, timestamp: new Date().toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════ AI CANDIDATE SCORING ═══════════

/**
 * Master job database — mirrors the allJobs array in index.html.
 * Used to look up the job a candidate applied for and score them against it.
 */
const JOB_DATABASE = {
  "Senior Software Engineer — Cloud Platform": { dept: "engineering", tags: ["Go", "Kubernetes", "AWS"], salary: "£95K – £130K", loc: "London, UK", remote: false },
  "Staff Machine Learning Engineer": { dept: "engineering", tags: ["Python", "PyTorch", "MLOps"], salary: "$180K – $240K", loc: "New York, US", remote: false },
  "Frontend Engineer — Design Systems": { dept: "engineering", tags: ["React", "TypeScript", "Figma"], salary: "SGD 90K – 130K", loc: "Singapore", remote: false },
  "DevOps Engineer": { dept: "engineering", tags: ["Terraform", "CI/CD", "Azure"], salary: "€75K – €100K", loc: "Frankfurt, DE", remote: false },
  "Mobile Developer (iOS)": { dept: "engineering", tags: ["Swift", "SwiftUI", "Xcode"], salary: "¥10M – ¥14M", loc: "Tokyo, JP", remote: false },
  "Backend Engineer — Payments": { dept: "engineering", tags: ["Java", "Microservices", "Kafka"], salary: "£85K – £120K", loc: "London, UK", remote: false },
  "Data Engineer": { dept: "engineering", tags: ["Spark", "Airflow", "dbt"], salary: "₹25L – ₹40L", loc: "Bangalore, IN", remote: false },
  "Site Reliability Engineer": { dept: "engineering", tags: ["Linux", "Prometheus", "On-call"], salary: "$140K – $190K", loc: "Remote (Global)", remote: true },
  "Security Engineer — Application Security": { dept: "security", tags: ["OWASP", "Pen Testing", "SAST"], salary: "£90K – £125K", loc: "London, UK", remote: false },
  "Cybersecurity Analyst": { dept: "security", tags: ["SIEM", "Incident Response", "Clearance"], salary: "AED 280K – 380K", loc: "Dubai, UAE", remote: false },
  "Product Manager — Enterprise Platform": { dept: "product", tags: ["B2B SaaS", "Roadmapping", "Analytics"], salary: "$160K – $210K", loc: "New York, US", remote: false },
  "Senior UX Designer": { dept: "product", tags: ["Figma", "Research", "Design Systems"], salary: "£80K – £105K", loc: "London, UK", remote: false },
  "UX Researcher": { dept: "product", tags: ["User Testing", "Surveys", "Analytics"], salary: "SGD 75K – 105K", loc: "Singapore", remote: false },
  "Product Designer — Mobile": { dept: "product", tags: ["Mobile UX", "Prototyping", "Figma"], salary: "€65K – €90K", loc: "Remote (EMEA)", remote: true },
  "Enterprise Account Executive": { dept: "sales", tags: ["SaaS Sales", "Enterprise", "$1M+ Deals"], salary: "$140K + OTE $280K", loc: "New York, US", remote: false },
  "Business Development Manager — APAC": { dept: "sales", tags: ["Partnerships", "APAC Markets", "Strategy"], salary: "SGD 120K – 160K", loc: "Singapore", remote: false },
  "Sales Development Representative": { dept: "sales", tags: ["Outbound", "Salesforce", "SaaS"], salary: "£35K + OTE £55K", loc: "London, UK", remote: false },
  "Solutions Architect — Pre-Sales": { dept: "sales", tags: ["Cloud", "Technical Sales", "Demos"], salary: "€95K – €130K", loc: "Frankfurt, DE", remote: false },
  "Management Consultant — Digital Transformation": { dept: "consulting", tags: ["Strategy", "Digital", "Client-Facing"], salary: "£75K – £110K", loc: "London, UK", remote: false },
  "Senior Strategy Consultant": { dept: "consulting", tags: ["M&A", "Due Diligence", "GCC Markets"], salary: "AED 350K – 480K", loc: "Dubai, UAE", remote: false },
  "Principal Consultant — Change Management": { dept: "consulting", tags: ["Org Design", "Stakeholder Mgmt"], salary: "AUD 160K – 210K", loc: "Sydney, AU", remote: false },
  "Financial Analyst — FP&A": { dept: "finance", tags: ["Modelling", "SAP", "Reporting"], salary: "£55K – £75K", loc: "London, UK", remote: false },
  "Senior Tax Manager — International": { dept: "finance", tags: ["Transfer Pricing", "BEPS", "CPA"], salary: "$130K – $170K", loc: "New York, US", remote: false },
  "Internal Audit Manager": { dept: "finance", tags: ["SOX", "Risk", "Big 4 Preferred"], salary: "SGD 100K – 140K", loc: "Singapore", remote: false },
  "Talent Acquisition Partner — Technology": { dept: "hr", tags: ["Tech Recruitment", "Sourcing", "ATS"], salary: "£55K – £75K", loc: "London, UK", remote: false },
  "HR Business Partner — APAC": { dept: "hr", tags: ["HRBP", "Employee Relations", "Regional"], salary: "SGD 95K – 130K", loc: "Singapore", remote: false },
  "Learning & Development Manager": { dept: "hr", tags: ["L&D Strategy", "LMS", "Coaching"], salary: "£65K – £85K", loc: "Remote (EMEA)", remote: true },
  "Global Employer Brand Lead": { dept: "marketing", tags: ["Employer Brand", "EVP", "Creative"], salary: "£70K – £95K", loc: "London, UK", remote: false },
  "Digital Marketing Manager": { dept: "marketing", tags: ["SEO", "Paid Media", "Analytics"], salary: "$90K – $120K", loc: "New York, US", remote: false },
  "Content Strategist": { dept: "marketing", tags: ["Copywriting", "Content Strategy", "B2B"], salary: "$70/hr", loc: "Remote (Global)", remote: true },
  "Supply Chain Operations Manager": { dept: "operations", tags: ["Logistics", "SAP SCM", "LATAM"], salary: "BRL 220K – 300K", loc: "São Paulo, BR", remote: false },
  "Facilities Director — EMEA": { dept: "operations", tags: ["FM", "Sustainability", "Multi-Site"], salary: "£90K – £120K", loc: "London, UK", remote: false },
  "Legal Counsel — Commercial Contracts": { dept: "legal", tags: ["Commercial Law", "SaaS Contracts", "GDPR"], salary: "£85K – £115K", loc: "London, UK", remote: false },
  "Compliance Officer — Financial Services": { dept: "legal", tags: ["MiFID II", "AML", "Regulatory"], salary: "€80K – €110K", loc: "Frankfurt, DE", remote: false },
  "Clinical Systems Analyst": { dept: "healthcare", tags: ["HL7 FHIR", "EHR", "Healthcare IT"], salary: "CAD 85K – 115K", loc: "Toronto, CA", remote: false },
  "Renewable Energy Project Engineer": { dept: "energy", tags: ["Solar", "Wind", "Project Mgmt"], salary: "AED 240K – 340K", loc: "Dubai, UAE", remote: false },
  "Software Engineering Intern — Summer 2026": { dept: "engineering", tags: ["12 Weeks", "Mentorship", "Paid"], salary: "£30K pro-rata", loc: "London, UK", remote: false },
  "Consulting Analyst Intern — Summer 2026": { dept: "consulting", tags: ["10 Weeks", "Strategy", "Paid"], salary: "$40/hr", loc: "New York, US", remote: false },
  "Data Science Intern": { dept: "engineering", tags: ["Python", "ML", "12 Weeks"], salary: "SGD 3,500/mo", loc: "Singapore", remote: false },
  "Contract Technical Writer": { dept: "product", tags: ["API Docs", "Technical Writing"], salary: "$65/hr", loc: "Remote (Global)", remote: true },
  "Contract SAP FICO Consultant": { dept: "consulting", tags: ["SAP S/4HANA", "FICO", "6 Months"], salary: "€700/day", loc: "Frankfurt, DE", remote: false },
  "Platform Engineer — Kubernetes": { dept: "engineering", tags: ["K8s", "Helm", "GitOps"], salary: "$150K – $200K", loc: "Remote (Americas)", remote: true },
  "AI Research Scientist": { dept: "engineering", tags: ["LLMs", "NLP", "PhD Preferred"], salary: "SGD 140K – 200K", loc: "Singapore", remote: false },
  "Vice President — Client Partnerships": { dept: "sales", tags: ["C-Suite Access", "Revenue Growth"], salary: "$200K + Equity", loc: "New York, US", remote: false },
  "ESG Reporting Analyst": { dept: "energy", tags: ["CSRD", "GRI", "Sustainability"], salary: "£50K – £70K", loc: "London, UK", remote: false },
  "Head of Diversity, Equity & Inclusion": { dept: "hr", tags: ["DEI Strategy", "Executive-Level"], salary: "£110K – £140K", loc: "London, UK", remote: false }
};

/** Department requirements — used for deeper scoring */
const DEPT_REQUIREMENTS = {
  engineering: ["Strong foundation in computer science fundamentals and software engineering", "Experience with modern development practices (CI/CD, testing, version control)", "Ability to work independently and as part of a distributed team", "Excellent communication skills"],
  product: ["Proven track record of delivering user-centred products or designs", "Strong portfolio demonstrating design thinking and problem-solving", "Proficiency in modern design and prototyping tools", "Data-informed decision making"],
  sales: ["Proven track record in enterprise or B2B sales", "Excellent relationship-building and negotiation skills", "Ability to navigate complex multi-stakeholder sales cycles", "Strong commercial acumen"],
  consulting: ["Consulting or advisory experience at a top-tier firm", "Excellent analytical communication and presentation skills", "Ability to manage ambiguity and deliver under pressure", "Strong client-facing skills"],
  finance: ["Qualified accountant (ACA, ACCA, CPA, CIMA) or equivalent", "Strong financial modelling and analytical skills", "Experience with ERP systems (SAP, Oracle)", "Excellent attention to detail"],
  hr: ["Proven HR generalist or specialist experience in a complex global organisation", "Strong knowledge of employment law and best practice", "Excellent interpersonal coaching and influencing skills", "Data-literate with HRIS experience"],
  marketing: ["Strong marketing experience in B2B or enterprise environments", "Proficiency in digital marketing platforms and analytics tools", "Creative thinker with excellent communication", "Ability to manage multiple projects"],
  operations: ["Significant operational management experience in a complex global business", "Strong project management and stakeholder engagement skills", "Knowledge of lean six sigma or continuous improvement", "Commercial awareness and budget management"],
  legal: ["Qualified lawyer with relevant post-qualification experience", "Strong drafting analytical and negotiation skills", "Ability to provide pragmatic business-oriented legal advice", "Multi-jurisdictional experience preferred"],
  healthcare: ["Experience in healthcare IT clinical informatics or health tech", "Knowledge of health data standards and interoperability", "Strong analytical and problem-solving skills", "Ability to communicate with clinical and technical stakeholders"],
  energy: ["Experience in renewable energy sustainability or environmental consulting", "Strong project management and technical skills", "Knowledge of ESG reporting frameworks (GRI, CSRD, TCFD)", "Passionate about sustainability"],
  security: ["Relevant cybersecurity or defence sector experience", "Security certifications (CISSP, CISM, CEH) preferred", "Ability to obtain security clearances", "Strong analytical and problem-solving skills"]
};

/**
 * Score a candidate application against the job they applied for.
 * Called from the ATS "Request AI Review" button or auto-triggered on new applications.
 */
function scoreApplication(data) {
  const { id } = data;
  if (!id) return { success: false, error: 'Missing application id' };

  // Fetch the application from the sheet
  const appResult = getApplicationById(id);
  if (!appResult.success) return appResult;
  const app = appResult.application;

  // Look up the job
  const jobTitle = app.job || '';
  const job = JOB_DATABASE[jobTitle];

  // Build the scorecard
  const scorecard = buildScorecard(app, job, jobTitle);

  // Store scorecard as a note on the application
  const sheet = getSheet('Applications');
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idCol = headers.indexOf('id');
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idCol] === id) { rowIndex = i + 1; break; }
  }

  if (rowIndex > 0) {
    // Update the notes column with the scorecard
    const notesCol = headers.indexOf('notes') + 1;
    const existingNotes = allData[rowIndex - 1][notesCol - 1];
    let notes = [];
    try { notes = typeof existingNotes === 'string' && existingNotes ? JSON.parse(existingNotes) : []; }
    catch (e) { notes = []; }

    // Remove any previous AI scorecard note
    notes = notes.filter(n => n.author !== 'AI Review Agent');

    // Add the new scorecard note
    notes.unshift({
      text: scorecard.summaryText,
      author: 'AI Review Agent',
      date: new Date().toISOString()
    });

    sheet.getRange(rowIndex, notesCol).setValue(JSON.stringify(notes));

    // Update AI rating based on overall score (1-5 star scale)
    // Note: 'rating' is the human score — we write to 'aiRating' instead
    const aiRatingCol = headers.indexOf('aiRating') + 1;
    if (aiRatingCol > 0) {
      sheet.getRange(rowIndex, aiRatingCol).setValue(scorecard.overallStars);
    }

    // Add timeline entry
    const timelineCol = headers.indexOf('timeline') + 1;
    const existingTimeline = allData[rowIndex - 1][timelineCol - 1];
    let timeline = [];
    try { timeline = typeof existingTimeline === 'string' && existingTimeline ? JSON.parse(existingTimeline) : []; }
    catch (e) { timeline = []; }
    timeline.push({ action: 'AI scored: ' + scorecard.overallLabel + ' (' + scorecard.overallPercent + '%)', date: new Date().toISOString() });
    sheet.getRange(rowIndex, timelineCol).setValue(JSON.stringify(timeline));
  }

  // Send scorecard email notification
  try {
    const candidateName = (app.firstName || '') + ' ' + (app.lastName || '');
    const subject = '[AI Scorecard] ' + jobTitle + ' — ' + candidateName + ' (' + scorecard.overallPercent + '%)';
    const htmlBody = buildScorecardEmail(app, scorecard, jobTitle);
    GmailApp.sendEmail(NOTIFICATION_EMAIL, subject, '', {
      htmlBody: htmlBody,
      name: SENDER_NAME
    });
  } catch (err) {
    Logger.log('Scorecard email failed: ' + err.message);
  }

  return { success: true, id: id, scorecard: scorecard };
}

/**
 * Build a comprehensive scorecard for a candidate vs a job.
 * Returns an object with scores, labels, and formatted text.
 */
function buildScorecard(app, job, jobTitle) {
  const scores = {};

  // ── 1. SKILLS MATCH (weight: 30%) ──
  scores.skills = scoreSkillsMatch(app, job);

  // ── 2. EXPERIENCE LEVEL (weight: 25%) ──
  scores.experience = scoreExperience(app, job, jobTitle);

  // ── 3. LOCATION FIT (weight: 15%) ──
  scores.location = scoreLocation(app, job);

  // ── 4. SALARY ALIGNMENT (weight: 10%) ──
  scores.salary = scoreSalary(app, job);

  // ── 5. RIGHT TO WORK (weight: 10%) ──
  scores.visa = scoreVisa(app);

  // ── 6. MOTIVATION & COMMUNICATION (weight: 10%) ──
  scores.motivation = scoreMotivation(app);

  // ── OVERALL WEIGHTED SCORE ──
  const weights = { skills: 0.30, experience: 0.25, location: 0.15, salary: 0.10, visa: 0.10, motivation: 0.10 };
  let overallPercent = 0;
  Object.keys(weights).forEach(k => {
    overallPercent += (scores[k].percent * weights[k]);
  });
  overallPercent = Math.round(overallPercent);

  const overallStars = percentToStars(overallPercent);
  const overallLabel = overallPercent >= 80 ? 'Strong Match' :
                       overallPercent >= 60 ? 'Good Match' :
                       overallPercent >= 40 ? 'Partial Match' : 'Weak Match';

  // Build observations
  const observations = [];
  if (scores.skills.percent >= 80) observations.push('Strong alignment on required technical skills');
  else if (scores.skills.percent < 40) observations.push('Significant skills gap — may need development or training');
  if (scores.experience.percent >= 80) observations.push('Experience level well-suited for the role seniority');
  else if (scores.experience.percent < 40) observations.push('Experience may be insufficient for the seniority expected');
  if (scores.location.percent < 50 && (!job || !job.remote)) observations.push('Location mismatch — relocation or remote arrangement may be needed');
  if (scores.salary.percent < 50) observations.push('Salary expectations may not align with the role budget');
  if (scores.visa.percent < 50) observations.push('Right to work is unconfirmed — sponsorship may be required');
  if (scores.motivation.percent >= 70) observations.push('Candidate provided a strong, detailed motivation statement');
  if (app.linkedin) observations.push('LinkedIn profile provided for further verification');
  if (!app.linkedin) observations.push('No LinkedIn profile provided — consider requesting');

  // Build recommendation
  let recommendation = '';
  if (overallPercent >= 80) recommendation = 'Proceed to screening call. This candidate shows strong alignment across key criteria for the role.';
  else if (overallPercent >= 60) recommendation = 'Consider for screening. Candidate has good potential but review flagged areas before progressing.';
  else if (overallPercent >= 40) recommendation = 'Review carefully. There are notable gaps that may require further assessment or discussion.';
  else recommendation = 'Low match against current requirements. Consider for talent pool or alternative roles.';

  // Build formatted text for the notes field
  const starStr = function(pct) { return starsFromPercent(pct); };
  const summaryText =
    '───────── AI CANDIDATE SCORECARD ─────────\n' +
    'OVERALL: ' + overallLabel + ' — ' + overallPercent + '%\n\n' +
    'Skills Match: ' + starStr(scores.skills.percent) + ' — ' + scores.skills.detail + '\n' +
    'Experience Level: ' + starStr(scores.experience.percent) + ' — ' + scores.experience.detail + '\n' +
    'Location Fit: ' + starStr(scores.location.percent) + ' — ' + scores.location.detail + '\n' +
    'Salary Alignment: ' + starStr(scores.salary.percent) + ' — ' + scores.salary.detail + '\n' +
    'Right to Work: ' + starStr(scores.visa.percent) + ' — ' + scores.visa.detail + '\n' +
    'Motivation: ' + starStr(scores.motivation.percent) + ' — ' + scores.motivation.detail + '\n\n' +
    '── KEY OBSERVATIONS ──\n' +
    observations.map(o => '• ' + o).join('\n') + '\n\n' +
    '── RECOMMENDATION ──\n' +
    recommendation + '\n\n' +
    'Assessed against: ' + (jobTitle || 'General Application') + '\n' +
    'Scored: ' + new Date().toISOString();

  return {
    overallPercent,
    overallStars,
    overallLabel,
    scores,
    observations,
    recommendation,
    summaryText
  };
}

// ── Individual scoring functions ──

function scoreSkillsMatch(app, job) {
  if (!job || !job.tags || !job.tags.length) {
    return { percent: 50, detail: 'No specific skills listed for this role' };
  }

  const candidateText = [
    app.motivation || '',
    app.experience || '',
    app.job || '',
    app.jobTags || ''
  ].join(' ').toLowerCase();

  let matched = 0;
  const matchedSkills = [];
  const missingSkills = [];

  job.tags.forEach(tag => {
    // Check for the tag and common variations
    const tagLower = tag.toLowerCase();
    const variations = [tagLower];
    // Add common abbreviation mappings
    if (tagLower === 'kubernetes') variations.push('k8s', 'kube');
    if (tagLower === 'k8s') variations.push('kubernetes', 'kube');
    if (tagLower === 'ci/cd') variations.push('cicd', 'ci cd', 'continuous integration', 'continuous deployment', 'jenkins', 'github actions');
    if (tagLower === 'react') variations.push('reactjs', 'react.js');
    if (tagLower === 'typescript') variations.push('ts', 'type script');
    if (tagLower === 'javascript') variations.push('js', 'node');
    if (tagLower === 'python') variations.push('py', 'django', 'flask', 'fastapi');
    if (tagLower === 'machine learning') variations.push('ml', 'deep learning', 'ai');
    if (tagLower === 'mlops') variations.push('ml ops', 'machine learning operations');

    const found = variations.some(v => candidateText.includes(v));
    if (found) {
      matched++;
      matchedSkills.push(tag);
    } else {
      missingSkills.push(tag);
    }
  });

  const pct = Math.round((matched / job.tags.length) * 100);
  const detail = matched + '/' + job.tags.length + ' required skills' +
    (matchedSkills.length ? ' (' + matchedSkills.join(', ') + ')' : '') +
    (missingSkills.length ? '. Missing: ' + missingSkills.join(', ') : '');

  return { percent: pct, detail: detail, matchedSkills, missingSkills };
}

function scoreExperience(app, job, jobTitle) {
  const exp = (app.experience || '').toLowerCase();
  const title = (jobTitle || '').toLowerCase();

  // Determine expected seniority from job title
  let expectedLevel = 'mid'; // default
  if (title.includes('intern') || title.includes('junior') || title.includes('graduate')) expectedLevel = 'junior';
  else if (title.includes('senior') || title.includes('staff') || title.includes('principal') || title.includes('lead')) expectedLevel = 'senior';
  else if (title.includes('head') || title.includes('director') || title.includes('vp') || title.includes('vice president')) expectedLevel = 'executive';
  else if (title.includes('manager')) expectedLevel = 'senior';

  // Parse candidate experience
  let years = 0;
  const yearMatch = exp.match(/(\d+)\s*(?:\+\s*)?(?:years?|yrs?)/i);
  if (yearMatch) years = parseInt(yearMatch[1]);
  else if (exp.includes('entry') || exp.includes('graduate') || exp.includes('junior')) years = 1;
  else if (exp.includes('mid')) years = 4;
  else if (exp.includes('senior')) years = 8;
  else if (exp.includes('lead') || exp.includes('principal')) years = 10;

  let pct = 50; // default if we can't determine
  let detail = '';

  if (years > 0 || exp) {
    const levelYears = { junior: [0, 2], mid: [3, 6], senior: [6, 12], executive: [10, 25] };
    const range = levelYears[expectedLevel] || [3, 6];

    if (years >= range[0] && years <= range[1] + 3) {
      pct = 90;
      detail = years + ' years experience — well-suited for ' + expectedLevel + ' level role';
    } else if (years >= range[0] - 1) {
      pct = 70;
      detail = years + ' years experience — adequate for ' + expectedLevel + ' level role';
    } else if (years > 0) {
      pct = Math.max(20, 50 - (range[0] - years) * 10);
      detail = years + ' years experience — below typical for ' + expectedLevel + ' level (' + range[0] + '-' + range[1] + ' years expected)';
    } else {
      detail = 'Experience: ' + (exp || 'not specified');
    }
  } else {
    detail = 'Experience level not clearly stated';
    pct = 30;
  }

  return { percent: pct, detail: detail };
}

function scoreLocation(app, job) {
  if (!job) return { percent: 50, detail: 'Job location not determined' };
  if (job.remote) return { percent: 90, detail: 'Remote role — location flexible' };

  const candidateLoc = (app.location || '').toLowerCase();
  const jobLoc = (job.loc || '').toLowerCase();

  if (!candidateLoc) return { percent: 40, detail: 'Candidate location not provided' };

  // Extract city/country keywords from both
  const jobParts = jobLoc.replace(/[,()]/g, ' ').split(/\s+/).filter(Boolean);
  const candParts = candidateLoc.replace(/[,()]/g, ' ').split(/\s+/).filter(Boolean);

  // Check for exact or partial match
  const matchedParts = jobParts.filter(jp => candParts.some(cp => cp.includes(jp) || jp.includes(cp)));

  if (matchedParts.length >= 1) {
    return { percent: 95, detail: 'Candidate location matches: ' + job.loc };
  }

  // Check same country
  const countryMap = {
    'uk': ['london', 'manchester', 'birmingham', 'uk', 'united kingdom', 'england', 'britain'],
    'us': ['new york', 'san francisco', 'seattle', 'us', 'usa', 'united states', 'america'],
    'de': ['frankfurt', 'berlin', 'munich', 'germany', 'de', 'deutschland'],
    'sg': ['singapore', 'sg'],
    'ae': ['dubai', 'uae', 'abu dhabi', 'emirates'],
    'au': ['sydney', 'melbourne', 'australia', 'au'],
    'jp': ['tokyo', 'osaka', 'japan', 'jp'],
    'in': ['bangalore', 'mumbai', 'delhi', 'india', 'in'],
    'br': ['sao paulo', 'brazil', 'br'],
    'ca': ['toronto', 'vancouver', 'canada', 'ca']
  };

  let sameCountry = false;
  Object.values(countryMap).forEach(locations => {
    const jobMatch = locations.some(l => jobLoc.includes(l));
    const candMatch = locations.some(l => candidateLoc.includes(l));
    if (jobMatch && candMatch) sameCountry = true;
  });

  if (sameCountry) {
    return { percent: 70, detail: 'Same country but different city — relocation may be needed' };
  }

  return { percent: 25, detail: 'Location mismatch: candidate in ' + (app.location || 'unknown') + ', role in ' + job.loc };
}

function scoreSalary(app, job) {
  if (!job || !job.salary) return { percent: 50, detail: 'Role salary not specified' };

  const candSalary = (app.salary || '').trim();
  if (!candSalary) return { percent: 50, detail: 'Candidate salary expectation not provided' };

  // Try to extract numbers from both
  const jobNums = extractSalaryNumbers(job.salary);
  const candNums = extractSalaryNumbers(candSalary);

  if (!jobNums.length || !candNums.length) {
    return { percent: 50, detail: 'Cannot compare: ' + candSalary + ' vs ' + job.salary };
  }

  const jobMax = Math.max(...jobNums);
  const jobMin = Math.min(...jobNums);
  const candVal = candNums[0]; // Take the first/primary number

  // Check if currencies match (rough check)
  const jobCurr = detectCurrency(job.salary);
  const candCurr = detectCurrency(candSalary);
  if (jobCurr && candCurr && jobCurr !== candCurr) {
    return { percent: 40, detail: 'Different currencies: candidate ' + candSalary + ' vs role ' + job.salary };
  }

  if (candVal >= jobMin && candVal <= jobMax) {
    return { percent: 95, detail: 'Within range: ' + candSalary + ' (role: ' + job.salary + ')' };
  } else if (candVal < jobMin) {
    const diff = Math.round(((jobMin - candVal) / jobMin) * 100);
    if (diff < 15) return { percent: 80, detail: 'Slightly below range — good for budget' };
    return { percent: 70, detail: 'Below range by ~' + diff + '% — candidate may accept' };
  } else {
    const diff = Math.round(((candVal - jobMax) / jobMax) * 100);
    if (diff < 10) return { percent: 65, detail: 'Slightly above budget — may be negotiable' };
    if (diff < 25) return { percent: 40, detail: 'Above budget by ~' + diff + '% — ' + candSalary + ' vs ' + job.salary };
    return { percent: 20, detail: 'Significantly above budget: ' + candSalary + ' vs ' + job.salary };
  }
}

function scoreVisa(app) {
  const visa = (app.visa || '').toLowerCase();
  if (!visa) return { percent: 30, detail: 'Right to work status not provided' };
  if (visa.includes('yes') || visa.includes('citizen') || visa.includes('permanent') || visa.includes('settled') || visa.includes('british') || visa.includes('eu national') || visa.includes('no sponsorship needed')) {
    return { percent: 100, detail: 'Confirmed right to work' };
  }
  if (visa.includes('visa') || visa.includes('sponsorship') || visa.includes('require') || visa.includes('need')) {
    return { percent: 30, detail: 'Requires visa sponsorship' };
  }
  return { percent: 50, detail: 'Right to work: ' + app.visa };
}

function scoreMotivation(app) {
  const text = (app.motivation || '').trim();
  if (!text) return { percent: 20, detail: 'No motivation statement provided' };

  const wordCount = text.split(/\s+/).length;
  let pct = 30;
  let detail = '';

  if (wordCount < 15) {
    pct = 30;
    detail = 'Very brief motivation (' + wordCount + ' words)';
  } else if (wordCount < 50) {
    pct = 55;
    detail = 'Adequate motivation statement (' + wordCount + ' words)';
  } else if (wordCount < 150) {
    pct = 75;
    detail = 'Good, detailed motivation (' + wordCount + ' words)';
  } else {
    pct = 90;
    detail = 'Comprehensive motivation statement (' + wordCount + ' words)';
  }

  // Bonus for mentioning company/role specifics
  const textLower = text.toLowerCase();
  if (textLower.includes('acquire talent') || textLower.includes('atp')) pct = Math.min(100, pct + 5);
  if (textLower.includes(app.job ? app.job.toLowerCase().split(' ')[0] : '___')) pct = Math.min(100, pct + 5);

  return { percent: pct, detail: detail };
}

// ── Scoring helpers ──

function extractSalaryNumbers(str) {
  const nums = [];
  const matches = str.match(/[\d,]+\.?\d*/g);
  if (matches) {
    matches.forEach(m => {
      const n = parseFloat(m.replace(/,/g, ''));
      if (n > 0) nums.push(n);
    });
  }
  return nums;
}

function detectCurrency(str) {
  if (str.includes('£')) return 'GBP';
  if (str.includes('$') && !str.includes('SGD') && !str.includes('AUD') && !str.includes('CAD')) return 'USD';
  if (str.includes('€')) return 'EUR';
  if (str.includes('SGD')) return 'SGD';
  if (str.includes('AUD')) return 'AUD';
  if (str.includes('CAD')) return 'CAD';
  if (str.includes('AED')) return 'AED';
  if (str.includes('¥')) return 'JPY';
  if (str.includes('₹')) return 'INR';
  if (str.includes('BRL')) return 'BRL';
  return '';
}

function percentToStars(pct) {
  if (pct >= 85) return 5;
  if (pct >= 70) return 4;
  if (pct >= 50) return 3;
  if (pct >= 30) return 2;
  return 1;
}

function starsFromPercent(pct) {
  const filled = percentToStars(pct);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/**
 * Build a styled HTML email for the scorecard notification.
 */
function buildScorecardEmail(app, scorecard, jobTitle) {
  const candidateName = (app.firstName || '') + ' ' + (app.lastName || '');

  const dimColor = function(pct) {
    if (pct >= 80) return '#10b981';
    if (pct >= 60) return '#f59e0b';
    if (pct >= 40) return '#f97316';
    return '#ef4444';
  };

  const overallColor = dimColor(scorecard.overallPercent);

  let rows = '';
  const dims = [
    { label: 'Skills Match', key: 'skills', weight: '30%' },
    { label: 'Experience Level', key: 'experience', weight: '25%' },
    { label: 'Location Fit', key: 'location', weight: '15%' },
    { label: 'Salary Alignment', key: 'salary', weight: '10%' },
    { label: 'Right to Work', key: 'visa', weight: '10%' },
    { label: 'Motivation', key: 'motivation', weight: '10%' }
  ];

  dims.forEach((d, i) => {
    const s = scorecard.scores[d.key];
    const bg = i % 2 === 0 ? '#f8fafc' : '#fff';
    const col = dimColor(s.percent);
    rows += '<tr style="background:' + bg + ';">' +
      '<td style="padding:8px 12px;font-weight:600;color:#1a1a2e;">' + d.label + ' <span style="font-weight:400;color:#94a3b8;font-size:11px;">(' + d.weight + ')</span></td>' +
      '<td style="padding:8px 12px;text-align:center;color:' + col + ';font-weight:700;">' + s.percent + '%</td>' +
      '<td style="padding:8px 12px;color:#64748b;font-size:12px;">' + s.detail + '</td>' +
      '</tr>';
  });

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:20px;">&#9733; AI Candidate Scorecard</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px;">${candidateName} — ${jobTitle}</p>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 12px 12px;">

        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background:${overallColor}22;border:2px solid ${overallColor};border-radius:12px;padding:16px 32px;">
            <div style="font-size:36px;font-weight:800;color:${overallColor};">${scorecard.overallPercent}%</div>
            <div style="font-size:14px;font-weight:600;color:${overallColor};margin-top:4px;">${scorecard.overallLabel}</div>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
          <tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:8px 12px;text-align:left;">Dimension</th>
            <th style="padding:8px 12px;text-align:center;width:60px;">Score</th>
            <th style="padding:8px 12px;text-align:left;">Detail</th>
          </tr>
          ${rows}
        </table>

        <div style="margin:16px 0;padding:12px;background:#f8fafc;border-radius:8px;">
          <strong style="color:#1a1a2e;">Key Observations</strong>
          ${scorecard.observations.map(o => '<p style="margin:6px 0;font-size:13px;color:#475569;">• ' + o + '</p>').join('')}
        </div>

        <div style="margin:16px 0;padding:12px;background:${overallColor}11;border-left:3px solid ${overallColor};border-radius:4px;">
          <strong style="color:#1a1a2e;">Recommendation</strong>
          <p style="margin:6px 0;font-size:13px;color:#475569;">${scorecard.recommendation}</p>
        </div>

        <p style="font-size:11px;color:#94a3b8;margin-top:20px;">Application ID: ${app.id} | Scored: ${new Date().toISOString()}</p>
      </div>
    </div>
  `;
}

// ═══════════ HELPERS ═══════════

function getSheet(name) {
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (!files.hasNext()) {
    // Auto-create if missing
    setup();
    const files2 = DriveApp.getFilesByName(SPREADSHEET_NAME);
    if (!files2.hasNext()) throw new Error('Could not create spreadsheet');
    return SpreadsheetApp.open(files2.next()).getSheetByName(name);
  }
  const ss = SpreadsheetApp.open(files.next());
  return ss.getSheetByName(name);
}

function buildNotificationEmail(data, appId, appliedDate) {
  const candidateName = (data.firstName || '') + ' ' + (data.lastName || '');
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: #1a1a2e; color: #fff; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">New Application Received</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">${appliedDate}</p>
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h2 style="margin: 0 0 16px; font-size: 16px; color: #1a1a2e;">Role: ${data.jobTitle || 'General Application'}</h2>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <tr><td style="padding:6px 12px; color:#64748b; width:140px;">Candidate</td><td style="padding:6px 12px; font-weight:600;">${candidateName}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px; color:#64748b;">Email</td><td style="padding:6px 12px;">${data.email || ''}</td></tr>
          <tr><td style="padding:6px 12px; color:#64748b;">Phone</td><td style="padding:6px 12px;">${data.phone || 'Not provided'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px; color:#64748b;">Location</td><td style="padding:6px 12px;">${data.location || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 12px; color:#64748b;">LinkedIn</td><td style="padding:6px 12px;">${data.linkedin || 'Not provided'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px; color:#64748b;">Salary</td><td style="padding:6px 12px;">${data.salary || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 12px; color:#64748b;">Notice</td><td style="padding:6px 12px;">${data.notice || 'Not provided'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px; color:#64748b;">Experience</td><td style="padding:6px 12px;">${data.experience || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 12px; color:#64748b;">Right to Work</td><td style="padding:6px 12px;">${data.visa || 'Not provided'}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px; color:#64748b;">Source</td><td style="padding:6px 12px;">${data.source || 'Careers Site'}</td></tr>
          <tr><td style="padding:6px 12px; color:#64748b;">Application ID</td><td style="padding:6px 12px; font-family:monospace;">${appId}</td></tr>
        </table>
        ${data.motivation ? '<div style="margin-top:16px; padding:12px; background:#f8fafc; border-radius:8px; font-size:13px;"><strong style="color:#1a1a2e;">Motivation:</strong><br>' + data.motivation + '</div>' : ''}
      </div>
    </div>
  `;
}
