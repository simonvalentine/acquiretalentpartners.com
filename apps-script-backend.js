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

// ── Gemini AI Configuration ──
// To enable AI-powered screening:
// 1. Go to https://aistudio.google.com/apikey
// 2. Create an API key and paste it below
// 3. Re-deploy your web app
const GEMINI_API_KEY = ''; // ← PASTE YOUR GEMINI API KEY HERE
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';

// Screening weights (Match vs Screen)
const MATCH_WEIGHT = 0.55;  // Profile-based match score weight
const SCREEN_WEIGHT = 0.45; // Response-based screening score weight

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
  sheet.getRange(1, 1, 1, 30).setValues([[
    'id', 'firstName', 'lastName', 'email', 'phone', 'location',
    'linkedin', 'salary', 'notice', 'experience', 'visa',
    'motivation', 'source', 'job', 'department',
    'jobTags', 'jobSalary', 'jobLocation',
    'status', 'rating', 'aiRating', 'appliedDate',
    'notes', 'timeline', 'commPreference', 'commDetails',
    'cvFileUrl', 'cvFileName', 'clFileUrl', 'clFileName',
    'screenResponses', 'matchScore', 'screenScore', 'combinedScore', 'aiNarrative'
  ]]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 30).setFontWeight('bold');

  // Talent Network sheet
  const tnSheet = ss.insertSheet('Talent Network');
  tnSheet.getRange(1, 1, 1, 9).setValues([[
    'id', 'name', 'email', 'profileUrl',
    'departments', 'roles', 'locations',
    'joinedDate', 'resumeFileName'
  ]]);
  tnSheet.setFrozenRows(1);
  tnSheet.getRange(1, 1, 1, 9).setFontWeight('bold');

  // Screening Questions sheet (Winston Screen equivalent)
  const sqSheet = ss.insertSheet('Screening Questions');
  sqSheet.getRange(1, 1, 1, 8).setValues([[
    'jobTitle', 'questions', 'weights', 'mustHaves',
    'generatedBy', 'generatedDate', 'editedDate', 'active'
  ]]);
  sqSheet.setFrozenRows(1);
  sqSheet.getRange(1, 1, 1, 8).setFontWeight('bold');

  Logger.log('Created spreadsheet: ' + ss.getUrl());
  return ss;
}

// ═══════════ GEMINI AI HELPER ═══════════

/**
 * Call Gemini API with a prompt and return the text response.
 * Returns null if API key is not set or call fails.
 */
function callGemini(prompt, temperature) {
  if (!GEMINI_API_KEY) {
    Logger.log('Gemini API key not configured — skipping AI call');
    return null;
  }

  temperature = temperature || 0.3;

  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(GEMINI_URL + '?key=' + GEMINI_API_KEY, options);
    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    }

    Logger.log('Gemini response had no candidates: ' + JSON.stringify(json));
    return null;
  } catch (err) {
    Logger.log('Gemini API error: ' + err.message);
    return null;
  }
}

/**
 * Call Gemini without JSON response format (for free-text responses).
 */
function callGeminiText(prompt, temperature) {
  if (!GEMINI_API_KEY) {
    Logger.log('Gemini API key not configured — skipping AI call');
    return null;
  }

  temperature = temperature || 0.4;

  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 2048
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(GEMINI_URL + '?key=' + GEMINI_API_KEY, options);
    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    }

    return null;
  } catch (err) {
    Logger.log('Gemini API error: ' + err.message);
    return null;
  }
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
    case 'getScreeningQuestions':
      result = getScreeningQuestions(e.parameter.jobTitle);
      break;
    case 'getAllScreeningQuestions':
      result = getAllScreeningQuestions();
      break;
    default:
      result = { success: true, status: 'ok', service: 'ATP Backend (Google Apps Script)', geminiConfigured: !!GEMINI_API_KEY };
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
    case 'generateScreeningQuestions':
      result = generateScreeningQuestions(data);
      break;
    case 'saveScreeningQuestions':
      result = saveScreeningQuestions(data);
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
      if (['notes', 'timeline', 'commPreference', 'commDetails', 'screenResponses'].includes(h)) {
        try { app[h] = typeof val === 'string' && val ? JSON.parse(val) : (val || (h === 'commPreference' ? ['Email'] : (h === 'commDetails' ? {} : []))); }
        catch (e) { app[h] = h === 'commPreference' ? ['Email'] : (h === 'commDetails' ? {} : (h === 'screenResponses' ? [] : [])); }
      } else if (h === 'rating' || h === 'aiRating' || h === 'matchScore' || h === 'screenScore' || h === 'combinedScore') {
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
  ensureApplicationHeaders(sheet);  // Auto-add any missing columns (schema upgrade)
  const appId = 'APP-' + new Date().getTime().toString(36).toUpperCase();
  const appliedDate = new Date().toISOString();
  const source = data.source || 'Careers Site';

  const notes = JSON.stringify([]);
  const timeline = JSON.stringify([{ action: 'Applied via ' + source, date: appliedDate }]);
  const commPref = JSON.stringify(data.commPreference || ['Email']);
  const commDet = JSON.stringify(data.commDetails || {});

  // ── Save CV / Cover Letter to Google Drive ──
  let cvFileUrl = '';
  let cvFileName = data.cvFileName || '';
  let clFileUrl = '';
  let clFileName = '';
  try {
    if (data.cvFile && data.cvFile.dataUrl) {
      const saved = saveFileToDrive(data.cvFile, appId, firstName + ' ' + lastName, 'CV');
      cvFileUrl = saved.url;
      cvFileName = saved.name;
    }
    if (data.coverLetterFile && data.coverLetterFile.dataUrl) {
      const saved = saveFileToDrive(data.coverLetterFile, appId, firstName + ' ' + lastName, 'Cover Letter');
      clFileUrl = saved.url;
      clFileName = saved.name;
    }
  } catch (err) {
    Logger.log('File upload to Drive failed: ' + err.message);
  }

  // Screening responses (from Winston Screen questions)
  const screenResponses = JSON.stringify(data.screenResponses || []);

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
    commDet,
    cvFileUrl,
    cvFileName,
    clFileUrl,
    clFileName,
    screenResponses,
    0,       // matchScore
    0,       // screenScore
    0,       // combinedScore
    ''       // aiNarrative
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
 * Enhanced with dual scoring: Match (profile) + Screen (responses) = Combined Score.
 * Called from the ATS "Request AI Review" button or auto-triggered on new applications.
 */
function scoreApplication(data) {
  const { id } = data;
  if (!id) return { success: false, error: 'Missing application id' };

  // Ensure all required columns exist (handles schema upgrades)
  const appSheet = getSheet('Applications');
  ensureApplicationHeaders(appSheet);

  // Fetch the application from the sheet
  const appResult = getApplicationById(id);
  if (!appResult.success) return appResult;
  const app = appResult.application;

  // Look up the job
  const jobTitle = app.job || '';
  const job = JOB_DATABASE[jobTitle];

  // ── LAYER 1: MATCH SCORE (Profile-based — Winston Match equivalent) ──
  const scorecard = buildScorecard(app, job, jobTitle);
  const matchScore = scorecard.overallPercent;

  // ── LAYER 2: SCREEN SCORE (Response-based — Winston Screen equivalent) ──
  let screenResult = { screenScore: 0, evaluations: [], narrative: '' };
  let screenQuestions = [];

  // Check if screening questions exist for this job and candidate has responses
  const sqResult = getScreeningQuestions(jobTitle);
  if (sqResult.success && sqResult.questions && sqResult.questions.length > 0) {
    screenQuestions = sqResult.questions;
    const screenResponses = app.screenResponses || [];
    if (screenResponses.length > 0) {
      screenResult = evaluateScreeningResponses(app, screenQuestions, screenResponses);
    }
  }

  const screenScore = screenResult.screenScore;
  const hasScreening = screenResult.evaluations.length > 0;

  // ── COMBINED SCORE ──
  let combinedScore = matchScore;
  if (hasScreening) {
    combinedScore = Math.round((matchScore * MATCH_WEIGHT) + (screenScore * SCREEN_WEIGHT));
  }

  const combinedStars = percentToStars(combinedScore);
  const combinedLabel = combinedScore >= 80 ? 'Strong Match' :
                        combinedScore >= 60 ? 'Good Match' :
                        combinedScore >= 40 ? 'Partial Match' : 'Weak Match';

  // ── AI NARRATIVE (Gemini-powered match explanation) ──
  const narrativeResult = generateMatchNarrative(app, scorecard, jobTitle);

  // Build the enhanced summary text including both scores
  const starStr = function(pct) { return starsFromPercent(pct); };
  let summaryText =
    '───────── AI CANDIDATE SCORECARD ─────────\n' +
    'OVERALL: ' + combinedLabel + ' — ' + combinedScore + '%\n';

  if (hasScreening) {
    summaryText += 'Match Score: ' + matchScore + '% | Screen Score: ' + screenScore + '%\n';
  }

  summaryText += '\n' +
    'Skills Match: ' + starStr(scorecard.scores.skills.percent) + ' — ' + scorecard.scores.skills.detail + '\n' +
    'Experience Level: ' + starStr(scorecard.scores.experience.percent) + ' — ' + scorecard.scores.experience.detail + '\n' +
    'Location Fit: ' + starStr(scorecard.scores.location.percent) + ' — ' + scorecard.scores.location.detail + '\n' +
    'Salary Alignment: ' + starStr(scorecard.scores.salary.percent) + ' — ' + scorecard.scores.salary.detail + '\n' +
    'Right to Work: ' + starStr(scorecard.scores.visa.percent) + ' — ' + scorecard.scores.visa.detail + '\n' +
    'Motivation: ' + starStr(scorecard.scores.motivation.percent) + ' — ' + scorecard.scores.motivation.detail + '\n';

  if (hasScreening) {
    summaryText += '\n── SCREENING RESPONSES ──\n';
    screenResult.evaluations.forEach((ev, i) => {
      const q = screenQuestions[i];
      summaryText += (q ? q.category.toUpperCase() : 'Q' + (i+1)) + ': ' + ev.score + '% — ' + ev.evaluation + (ev.redFlag ? ' ⚠️ RED FLAG' : '') + '\n';
    });
  }

  summaryText += '\n── KEY OBSERVATIONS ──\n' +
    scorecard.observations.map(o => '• ' + o).join('\n') + '\n\n' +
    '── AI NARRATIVE ──\n' +
    (narrativeResult.narrative || scorecard.recommendation) + '\n\n' +
    '── RECOMMENDATION ──\n' +
    (narrativeResult.nextStep || scorecard.recommendation) + '\n\n' +
    'Assessed against: ' + (jobTitle || 'General Application') + '\n' +
    'Scored: ' + new Date().toISOString();

  // ── WRITE TO SHEET ──
  const sheet = getSheet('Applications');
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idCol = headers.indexOf('id');
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idCol] === id) { rowIndex = i + 1; break; }
  }

  if (rowIndex > 0) {
    // Notes column
    const notesCol = headers.indexOf('notes') + 1;
    const existingNotes = allData[rowIndex - 1][notesCol - 1];
    let notes = [];
    try { notes = typeof existingNotes === 'string' && existingNotes ? JSON.parse(existingNotes) : []; }
    catch (e) { notes = []; }
    notes = notes.filter(n => n.author !== 'AI Review Agent');
    notes.unshift({ text: summaryText, author: 'AI Review Agent', date: new Date().toISOString() });
    sheet.getRange(rowIndex, notesCol).setValue(JSON.stringify(notes));

    // AI Rating (combined score on 1-5 scale)
    const aiRatingCol = headers.indexOf('aiRating') + 1;
    if (aiRatingCol > 0) sheet.getRange(rowIndex, aiRatingCol).setValue(combinedStars);

    // Match Score
    const matchCol = headers.indexOf('matchScore') + 1;
    if (matchCol > 0) sheet.getRange(rowIndex, matchCol).setValue(matchScore);

    // Screen Score
    const screenCol = headers.indexOf('screenScore') + 1;
    if (screenCol > 0) sheet.getRange(rowIndex, screenCol).setValue(screenScore);

    // Combined Score
    const combCol = headers.indexOf('combinedScore') + 1;
    if (combCol > 0) sheet.getRange(rowIndex, combCol).setValue(combinedScore);

    // AI Narrative
    const narCol = headers.indexOf('aiNarrative') + 1;
    if (narCol > 0) sheet.getRange(rowIndex, narCol).setValue(JSON.stringify(narrativeResult));

    // Timeline entry
    const timelineCol = headers.indexOf('timeline') + 1;
    const existingTimeline = allData[rowIndex - 1][timelineCol - 1];
    let timeline = [];
    try { timeline = typeof existingTimeline === 'string' && existingTimeline ? JSON.parse(existingTimeline) : []; }
    catch (e) { timeline = []; }
    timeline.push({
      action: 'AI scored: ' + combinedLabel + ' (' + combinedScore + '%' + (hasScreening ? ' — Match: ' + matchScore + '% | Screen: ' + screenScore + '%' : '') + ')',
      date: new Date().toISOString()
    });
    sheet.getRange(rowIndex, timelineCol).setValue(JSON.stringify(timeline));
  }

  // Send scorecard email notification
  try {
    const candidateName = (app.firstName || '') + ' ' + (app.lastName || '');
    const subject = '[AI Scorecard] ' + jobTitle + ' — ' + candidateName + ' (' + combinedScore + '%)';
    const htmlBody = buildScorecardEmail(app, scorecard, jobTitle, screenResult, combinedScore, narrativeResult);
    GmailApp.sendEmail(NOTIFICATION_EMAIL, subject, '', {
      htmlBody: htmlBody,
      name: SENDER_NAME
    });
  } catch (err) {
    Logger.log('Scorecard email failed: ' + err.message);
  }

  return {
    success: true,
    id: id,
    scorecard: scorecard,
    matchScore: matchScore,
    screenScore: screenScore,
    combinedScore: combinedScore,
    combinedLabel: combinedLabel,
    narrative: narrativeResult,
    screenEvaluations: screenResult.evaluations
  };
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
function buildScorecardEmail(app, scorecard, jobTitle, screenResult, combinedScore, narrativeResult) {
  screenResult = screenResult || { screenScore: 0, evaluations: [] };
  combinedScore = combinedScore || scorecard.overallPercent;
  narrativeResult = narrativeResult || {};
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
            <div style="font-size:36px;font-weight:800;color:${overallColor};">${combinedScore}%</div>
            <div style="font-size:14px;font-weight:600;color:${overallColor};margin-top:4px;">${scorecard.overallLabel}</div>
            ${screenResult.screenScore > 0 ? '<div style="font-size:11px;color:#64748b;margin-top:8px;">Match: ' + scorecard.overallPercent + '% | Screen: ' + screenResult.screenScore + '%</div>' : ''}
          </div>
        </div>
        ${narrativeResult.narrative ? '<div style="margin:0 0 16px;padding:12px;background:#f0f9ff;border-left:3px solid #2563eb;border-radius:4px;font-size:13px;color:#1e293b;line-height:1.6;">' + narrativeResult.narrative + '</div>' : ''}

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

// ═══════════ SCREENING QUESTIONS (Winston Screen) ═══════════

/**
 * Generate AI-powered screening questions for a job title.
 * Uses Gemini to create role-specific questions with weights and must-have flags.
 */
function generateScreeningQuestions(data) {
  const { jobTitle } = data;
  if (!jobTitle) return { success: false, error: 'Missing jobTitle' };

  const job = JOB_DATABASE[jobTitle];
  const deptKey = job ? job.dept : 'general';
  const deptReqs = DEPT_REQUIREMENTS[deptKey] || [];

  // Build the AI prompt
  const prompt = `You are an expert recruitment screening consultant. Generate exactly 5 screening questions for the following job:

Job Title: ${jobTitle}
Department: ${deptKey}
Required Skills/Tags: ${job ? job.tags.join(', ') : 'General'}
Location: ${job ? job.loc : 'Not specified'}
Salary Range: ${job ? job.salary : 'Not specified'}
Department Requirements: ${deptReqs.join('; ')}

Generate 5 screening questions that:
1. Assess technical competency and relevant experience
2. Evaluate cultural fit and motivation
3. Test problem-solving ability relevant to the role
4. Gauge the candidate's understanding of the industry/domain
5. Assess communication quality and self-awareness

For each question, specify:
- "question": the actual question text (clear, professional, open-ended)
- "category": one of "technical", "experience", "motivation", "problem_solving", "cultural_fit"
- "weight": importance from 1-5 (5 = must-have, 1 = nice-to-have)
- "mustHave": boolean — true if this is a dealbreaker
- "idealAnswer": a brief description of what a strong answer would include (for AI evaluation)

Return a JSON array of 5 question objects. Example format:
[
  {
    "question": "Describe your experience with...",
    "category": "technical",
    "weight": 5,
    "mustHave": true,
    "idealAnswer": "Should mention specific technologies..."
  }
]`;

  const aiResponse = callGemini(prompt, 0.4);

  let questions = [];
  if (aiResponse) {
    try {
      questions = JSON.parse(aiResponse);
      if (!Array.isArray(questions)) questions = [];
    } catch (e) {
      Logger.log('Failed to parse Gemini questions response: ' + e.message);
      questions = [];
    }
  }

  // Fallback: generate standard questions if Gemini is not available
  if (questions.length === 0) {
    questions = generateFallbackQuestions(jobTitle, job, deptKey);
  }

  // Save to the Screening Questions sheet
  saveQuestionsToSheet(jobTitle, questions, aiResponse ? 'gemini' : 'fallback');

  return { success: true, jobTitle: jobTitle, questions: questions, generatedBy: aiResponse ? 'gemini' : 'fallback' };
}

/**
 * Fallback question generation when Gemini is not available.
 */
function generateFallbackQuestions(jobTitle, job, deptKey) {
  const tags = job ? job.tags : [];
  const questions = [
    {
      question: 'What specific experience do you have that makes you a strong fit for the ' + jobTitle + ' role?',
      category: 'experience',
      weight: 5,
      mustHave: true,
      idealAnswer: 'Should reference relevant years of experience, specific projects, and direct skills matching the role requirements'
    },
    {
      question: tags.length > 0 ?
        'Describe your proficiency with the following technologies/skills: ' + tags.join(', ') + '. Which are you strongest in, and which would you need to develop?' :
        'What are the key technical skills or domain knowledge you would bring to this position?',
      category: 'technical',
      weight: 5,
      mustHave: true,
      idealAnswer: 'Should demonstrate hands-on experience with at least 60% of required skills and honest self-assessment of gaps'
    },
    {
      question: 'Tell us about a challenging project or problem you solved in a previous role. What was your approach and what was the outcome?',
      category: 'problem_solving',
      weight: 4,
      mustHave: false,
      idealAnswer: 'Should use STAR format, demonstrate analytical thinking, show measurable impact'
    },
    {
      question: 'Why are you interested in joining Acquire Talent Partners, and what attracted you to this specific role?',
      category: 'motivation',
      weight: 3,
      mustHave: false,
      idealAnswer: 'Should show research into the company, genuine enthusiasm, career alignment with the role'
    },
    {
      question: 'Describe your ideal working environment and team culture. How do you handle disagreements or conflicting priorities?',
      category: 'cultural_fit',
      weight: 3,
      mustHave: false,
      idealAnswer: 'Should demonstrate collaboration, professionalism, adaptability, and constructive conflict resolution'
    }
  ];
  return questions;
}

/**
 * Save screening questions to the sheet.
 */
function saveQuestionsToSheet(jobTitle, questions, generatedBy) {
  const sheet = getOrCreateScreeningSheet();
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const jobCol = headers.indexOf('jobTitle');

  // Find existing row for this job
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][jobCol] === jobTitle) { rowIndex = i + 1; break; }
  }

  const weights = questions.map(q => q.weight);
  const mustHaves = questions.map(q => q.mustHave);
  const now = new Date().toISOString();

  if (rowIndex > 0) {
    // Update existing row
    sheet.getRange(rowIndex, headers.indexOf('questions') + 1).setValue(JSON.stringify(questions));
    sheet.getRange(rowIndex, headers.indexOf('weights') + 1).setValue(JSON.stringify(weights));
    sheet.getRange(rowIndex, headers.indexOf('mustHaves') + 1).setValue(JSON.stringify(mustHaves));
    sheet.getRange(rowIndex, headers.indexOf('generatedBy') + 1).setValue(generatedBy);
    sheet.getRange(rowIndex, headers.indexOf('editedDate') + 1).setValue(now);
  } else {
    // New row
    sheet.appendRow([jobTitle, JSON.stringify(questions), JSON.stringify(weights), JSON.stringify(mustHaves), generatedBy, now, '', 'true']);
  }
}

/**
 * Get screening questions for a specific job.
 */
function getScreeningQuestions(jobTitle) {
  if (!jobTitle) return { success: false, error: 'Missing jobTitle' };

  const sheet = getOrCreateScreeningSheet();
  const allData = sheet.getDataRange().getValues();
  if (allData.length <= 1) return { success: true, jobTitle: jobTitle, questions: [], exists: false };

  const headers = allData[0];
  const jobCol = headers.indexOf('jobTitle');
  const qCol = headers.indexOf('questions');
  const activeCol = headers.indexOf('active');

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][jobCol] === jobTitle) {
      let questions = [];
      try { questions = JSON.parse(allData[i][qCol]); } catch (e) { questions = []; }
      const isActive = activeCol >= 0 ? String(allData[i][activeCol]) !== 'false' : true;
      return { success: true, jobTitle: jobTitle, questions: questions, exists: true, active: isActive };
    }
  }

  return { success: true, jobTitle: jobTitle, questions: [], exists: false };
}

/**
 * Get all screening questions for all jobs.
 */
function getAllScreeningQuestions() {
  const sheet = getOrCreateScreeningSheet();
  const allData = sheet.getDataRange().getValues();
  if (allData.length <= 1) return { success: true, jobs: [] };

  const headers = allData[0];
  const jobs = [];

  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    const entry = {};
    headers.forEach((h, j) => {
      const val = row[j];
      if (['questions', 'weights', 'mustHaves'].includes(h)) {
        try { entry[h] = typeof val === 'string' && val ? JSON.parse(val) : []; }
        catch (e) { entry[h] = []; }
      } else {
        entry[h] = val !== undefined && val !== null ? String(val) : '';
      }
    });
    jobs.push(entry);
  }

  return { success: true, jobs: jobs };
}

/**
 * Save edited screening questions from the ATS admin.
 */
function saveScreeningQuestions(data) {
  const { jobTitle, questions, active } = data;
  if (!jobTitle || !questions) return { success: false, error: 'Missing jobTitle or questions' };
  saveQuestionsToSheet(jobTitle, questions, 'manual');
  if (active !== undefined) {
    const sheet = getOrCreateScreeningSheet();
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const jobCol = headers.indexOf('jobTitle');
    const activeCol = headers.indexOf('active');
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][jobCol] === jobTitle && activeCol >= 0) {
        sheet.getRange(i + 1, activeCol + 1).setValue(active ? 'true' : 'false');
        break;
      }
    }
  }
  return { success: true, jobTitle: jobTitle };
}

function getOrCreateScreeningSheet() {
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (!files.hasNext()) { setup(); return getOrCreateScreeningSheet(); }
  const ss = SpreadsheetApp.open(files.next());
  let sheet = ss.getSheetByName('Screening Questions');
  if (!sheet) {
    sheet = ss.insertSheet('Screening Questions');
    sheet.getRange(1, 1, 1, 8).setValues([[
      'jobTitle', 'questions', 'weights', 'mustHaves',
      'generatedBy', 'generatedDate', 'editedDate', 'active'
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  return sheet;
}

// ═══════════ AI SCREENING EVALUATION (Winston Screen Score) ═══════════

/**
 * Evaluate a candidate's screening responses using Gemini AI.
 * Returns a screenScore (0-100) with per-question evaluations.
 */
function evaluateScreeningResponses(app, questions, responses) {
  if (!questions || !questions.length || !responses || !responses.length) {
    return { screenScore: 0, evaluations: [], narrative: 'No screening responses to evaluate.' };
  }

  // Build evaluation prompt
  const qaPairs = questions.map((q, i) => {
    const response = responses[i] || {};
    return {
      question: q.question,
      category: q.category,
      weight: q.weight,
      mustHave: q.mustHave,
      idealAnswer: q.idealAnswer,
      candidateAnswer: response.answer || '(No response provided)'
    };
  });

  const prompt = `You are an expert recruiter evaluating candidate screening responses for a ${app.job || 'role'} position.

Candidate: ${app.firstName || ''} ${app.lastName || ''}
Applied for: ${app.job || 'Unknown role'}

Evaluate each question-answer pair below. For each:
- Score 0-100 based on quality, relevance, depth, and alignment with the ideal answer
- Flag if a must-have question was answered poorly (below 40)
- Provide a brief evaluation (1-2 sentences)

Questions and Answers:
${qaPairs.map((qa, i) => `
Q${i+1} [${qa.category}] (Weight: ${qa.weight}/5, Must-have: ${qa.mustHave}):
"${qa.question}"
Ideal: ${qa.idealAnswer}
Candidate's answer: "${qa.candidateAnswer}"
`).join('\n')}

Return JSON:
{
  "evaluations": [
    { "questionIndex": 0, "score": 75, "evaluation": "Brief assessment...", "redFlag": false }
  ],
  "overallScreenScore": 72,
  "screenNarrative": "2-3 sentence overall assessment of the candidate's screening responses, highlighting strengths and concerns."
}`;

  const aiResponse = callGemini(prompt, 0.3);

  if (aiResponse) {
    try {
      const result = JSON.parse(aiResponse);
      return {
        screenScore: result.overallScreenScore || 0,
        evaluations: result.evaluations || [],
        narrative: result.screenNarrative || ''
      };
    } catch (e) {
      Logger.log('Failed to parse screening evaluation: ' + e.message);
    }
  }

  // Fallback: basic word-count scoring
  return evaluateScreeningFallback(questions, responses);
}

/**
 * Fallback screening evaluation when Gemini is not available.
 */
function evaluateScreeningFallback(questions, responses) {
  const evaluations = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  questions.forEach((q, i) => {
    const response = responses[i] || {};
    const answer = (response.answer || '').trim();
    const wordCount = answer ? answer.split(/\s+/).length : 0;

    let score = 0;
    let evaluation = '';
    let redFlag = false;

    if (wordCount === 0) {
      score = 0;
      evaluation = 'No response provided.';
      redFlag = q.mustHave;
    } else if (wordCount < 10) {
      score = 15;
      evaluation = 'Very brief response — insufficient detail for evaluation.';
      redFlag = q.mustHave;
    } else if (wordCount < 30) {
      score = 35;
      evaluation = 'Short response. Some relevant content but lacks depth.';
      redFlag = q.mustHave && q.weight >= 4;
    } else if (wordCount < 80) {
      score = 55;
      evaluation = 'Adequate response with moderate detail.';
    } else if (wordCount < 150) {
      score = 72;
      evaluation = 'Good, detailed response showing relevant knowledge.';
    } else {
      score = 85;
      evaluation = 'Comprehensive response demonstrating strong engagement.';
    }

    evaluations.push({ questionIndex: i, score: score, evaluation: evaluation, redFlag: redFlag });
    totalWeightedScore += score * q.weight;
    totalWeight += q.weight;
  });

  const overallScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  return {
    screenScore: overallScore,
    evaluations: evaluations,
    narrative: 'Screening evaluated using response length and completeness analysis. ' +
      (overallScore >= 60 ? 'Candidate provided adequate responses overall.' : 'Candidate responses were limited — further assessment recommended.')
  };
}

// ═══════════ AI NARRATIVE MATCH EXPLANATION (Winston Match) ═══════════

/**
 * Generate an AI-powered narrative explanation for the match score.
 * This replaces the basic observation bullets with SmartRecruiters-style explainability.
 */
function generateMatchNarrative(app, scorecard, jobTitle) {
  const prompt = `You are a senior recruitment AI producing a concise candidate assessment narrative for a recruiter.

Candidate: ${app.firstName || ''} ${app.lastName || ''}
Applied for: ${jobTitle}
Location: ${app.location || 'Not specified'}
Experience: ${app.experience || 'Not specified'}
Salary expectation: ${app.salary || 'Not specified'}
Visa/Right to work: ${app.visa || 'Not specified'}
Motivation: ${(app.motivation || '').substring(0, 300)}

Match Score Breakdown:
- Skills Match: ${scorecard.scores.skills.percent}% — ${scorecard.scores.skills.detail}
- Experience Level: ${scorecard.scores.experience.percent}% — ${scorecard.scores.experience.detail}
- Location Fit: ${scorecard.scores.location.percent}% — ${scorecard.scores.location.detail}
- Salary Alignment: ${scorecard.scores.salary.percent}% — ${scorecard.scores.salary.detail}
- Right to Work: ${scorecard.scores.visa.percent}% — ${scorecard.scores.visa.detail}
- Motivation: ${scorecard.scores.motivation.percent}% — ${scorecard.scores.motivation.detail}

Overall Match: ${scorecard.overallPercent}% (${scorecard.overallLabel})

Write a 3-4 sentence narrative assessment covering:
1. Overall fit summary (one line)
2. Key strengths that make this candidate stand out
3. Areas of concern or gaps to explore further
4. Recommended next step

Return JSON: { "narrative": "The assessment text...", "strengths": ["strength1","strength2"], "concerns": ["concern1"], "nextStep": "Recommended action" }`;

  const aiResponse = callGemini(prompt, 0.3);

  if (aiResponse) {
    try {
      return JSON.parse(aiResponse);
    } catch (e) {
      Logger.log('Failed to parse narrative response: ' + e.message);
    }
  }

  // Fallback narrative
  return {
    narrative: scorecard.overallLabel + ' at ' + scorecard.overallPercent + '%. ' + scorecard.recommendation,
    strengths: scorecard.observations.filter(o => o.includes('Strong') || o.includes('strong') || o.includes('well-suited') || o.includes('provided')),
    concerns: scorecard.observations.filter(o => o.includes('gap') || o.includes('mismatch') || o.includes('insufficient') || o.includes('unconfirmed')),
    nextStep: scorecard.recommendation
  };
}

// ═══════════ ENHANCED SCORE APPLICATION (Match + Screen + Combined) ═══════════

// Override the existing scoreApplication to add Screen scoring and narrative
// (The original is replaced below)

// ═══════════ HELPERS ═══════════

/**
 * Ensure the Applications sheet has all required headers.
 * Adds any missing columns to the right side of the sheet.
 * Call this at the start of submitApplication to handle schema upgrades gracefully.
 */
function ensureApplicationHeaders(sheet) {
  const requiredHeaders = [
    'id', 'firstName', 'lastName', 'email', 'phone', 'location',
    'linkedin', 'salary', 'notice', 'experience', 'visa',
    'motivation', 'source', 'job', 'department',
    'jobTags', 'jobSalary', 'jobLocation',
    'status', 'rating', 'aiRating', 'appliedDate',
    'notes', 'timeline', 'commPreference', 'commDetails',
    'cvFileUrl', 'cvFileName', 'clFileUrl', 'clFileName',
    'screenResponses', 'matchScore', 'screenScore', 'combinedScore', 'aiNarrative'
  ];

  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];

  const missing = requiredHeaders.filter(h => !existingHeaders.includes(h));
  if (missing.length > 0) {
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
    Logger.log('Added missing columns: ' + missing.join(', '));
  }
}

/**
 * Save a file (from base64 data URL) to Google Drive in a structured folder.
 * Creates an "ATP Applications" folder if it doesn't exist, then a subfolder per application.
 * Returns { url, name, id } of the saved file.
 */
function saveFileToDrive(fileData, appId, candidateName, docType) {
  if (!fileData || !fileData.dataUrl) return { url: '', name: '', id: '' };

  // Get or create the main "ATP Applications" folder
  const folders = DriveApp.getFoldersByName('ATP Applications');
  const mainFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder('ATP Applications');

  // Get or create a subfolder for this application
  const subFolders = mainFolder.getFoldersByName(appId);
  const appFolder = subFolders.hasNext() ? subFolders.next() : mainFolder.createFolder(appId + ' — ' + candidateName);

  // Decode the base64 data URL → blob
  const base64Match = fileData.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!base64Match) return { url: '', name: fileData.name || '', id: '' };

  const mimeType = base64Match[1];
  const base64Data = base64Match[2];
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileData.name || (docType + '.' + mimeType.split('/')[1]));

  // Save to Drive
  const file = appFolder.createFile(blob);
  file.setDescription(docType + ' for ' + candidateName + ' (' + appId + ')');

  // Make viewable by anyone with the link (so ATS users can open it)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    url: file.getUrl(),
    name: file.getName(),
    id: file.getId()
  };
}

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
