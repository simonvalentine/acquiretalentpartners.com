# ATP Backend Setup — Google Apps Script

**This replaces the Render server. Everything now runs through Google Workspace.**

---

## Step 1: Create the Apps Script

1. Go to [script.google.com](https://script.google.com)
2. Click **New Project**
3. Name it **ATP Backend**
4. Delete the default code in `Code.gs`
5. Open the file `apps-script-backend.js` and **copy the entire contents**
6. Paste it into `Code.gs`
7. Click **Save** (Ctrl+S)

## Step 2: Run Setup (creates the Google Sheet)

1. In the Apps Script editor, select **`setup`** from the function dropdown (top toolbar)
2. Click **Run**
3. It will ask for permissions — click **Review Permissions** → choose your Google account → **Allow**
4. Check the execution log — it will show the URL of the new "ATP ATS Database" spreadsheet
5. Open that spreadsheet to verify it has two sheets: **Applications** and **Talent Network**

## Step 3: Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon → select **Web app**
3. Set:
   - **Description**: ATP Backend
   - **Execute as**: **Me** (your Google account)
   - **Who has access**: **Anyone**
4. Click **Deploy**
5. **Copy the Web App URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## Step 4: Paste the URL into your HTML files

Open these two files and find `PASTE_YOUR_APPS_SCRIPT_URL_HERE`, then replace it with your Web App URL:

- **index.html** — one place (near line 2894)
- **ats-admin.html** — two places (near line 579 and line 755)

Use Find & Replace (Ctrl+H) to replace all instances of `PASTE_YOUR_APPS_SCRIPT_URL_HERE` with your URL.

## Step 5: Test it

1. Open `index.html` in your browser
2. Apply for a job (fill in the form and submit)
3. Open your "ATP ATS Database" Google Sheet — the application should appear in the Applications sheet
4. Open `ats-admin.html` — the application should appear in the candidates list
5. Check your email — you should receive a notification

---

## How it works

| Action | What happens |
|--------|-------------|
| Candidate applies on website | POST → Apps Script → saves to Google Sheet + sends you an email |
| Candidate joins talent network | POST → Apps Script → saves to Talent Network sheet |
| ATS admin loads | GET → Apps Script → reads all applications from the Sheet |
| You change status/rating/notes in ATS | POST → Apps Script → updates the Sheet row |
| You send an email template from ATS | POST → Apps Script → sends via Gmail |

All data lives in the Google Sheet. No external servers needed.

---

## Updating the deployment

If you ever update the code in Apps Script:
1. Click **Deploy** → **Manage deployments**
2. Click the pencil icon on your deployment
3. Change **Version** to **New version**
4. Click **Deploy**

The URL stays the same.
