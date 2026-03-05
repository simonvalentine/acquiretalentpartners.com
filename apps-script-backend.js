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
 *   POST {action:"submitApplication",...} → stores application + sends notification
 *   POST {action:"updateApplication",...} → updates status/rating/notes
 *   POST {action:"submitTalentNetwork",...} → stores talent network signup
 *   POST {action:"sendEmail",...}         → sends an email (for ATS templates)
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
  sheet.getRange(1, 1, 1, 25).setValues([[
    'id', 'firstName', 'lastName', 'email', 'phone', 'location',
    'linkedin', 'salary', 'notice', 'experience', 'visa',
    'motivation', 'source', 'job', 'department',
    'jobTags', 'jobSalary', 'jobLocation',
    'status', 'rating', 'appliedDate',
    'notes', 'timeline', 'commPreference', 'commDetails'
  ]]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 25).setFontWeight('bold');

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
      } else if (h === 'rating') {
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
    0,
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

  return { success: true, id: appId, timestamp: appliedDate };
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
