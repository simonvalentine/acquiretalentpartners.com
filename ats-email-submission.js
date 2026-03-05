/**
 * ATS Email Submission — Acquire Talent Partners
 *
 * ADD THIS SCRIPT to acquire-talent-partners.html, just before the closing </script> tag.
 *
 * It fires when a candidate submits their application, sends a structured
 * [New Application] email to hello@acquiretalentpartners.com via your email
 * server, and then shows the success screen as normal.
 *
 * INTEGRATION STEPS:
 * 1. Find the function that shows the success screen (where appRef is set and
 *    stepSuccess is shown). It likely looks like:
 *        document.getElementById('stepSuccess').style.display = 'block';
 *
 * 2. Replace that block with a call to submitApplicationAndAdvance().
 *    Or, find wherever you call saveToLocalStorage() / show success, and
 *    add:  await sendApplicationEmail(selectedJob, refCode);
 *    before the success screen is displayed.
 *
 * 3. Make sure the function containing your success logic is marked async,
 *    or call sendApplicationEmail(...).catch(console.error) if you don't want to await.
 */

const EMAIL_SERVER_URL = 'https://acquiretalentpartners-com.onrender.com';

/**
 * Sends a structured [New Application] email to hello@acquiretalentpartners.com.
 * @param {Object} job  - The selected job object (title, dept, tags, salary, locLabel)
 * @param {string} ref  - The generated reference code, e.g. REF-20260305-1234
 */
async function sendApplicationEmail(job, ref) {
  // ── Gather candidate fields ──────────────────────────────────────────────
  const val = id => (document.getElementById(id)?.value || '').trim();

  const firstName   = val('appFirstName');
  const lastName    = val('appLastName');
  const fullName    = `${firstName} ${lastName}`.trim();
  const email       = val('appEmail');
  const phone       = val('appPhone');
  const location    = val('appLocation');
  const linkedin    = val('appLinkedIn') || 'Not provided';
  const salary      = val('appSalary')   || 'Not specified';
  const notice      = val('appNotice')   || 'Not specified';
  const experience  = val('appExperience') || 'Not specified';
  const visa        = val('appVisa')     || 'Not specified';
  const source      = val('appSource')   || 'Not specified';
  const motivation  = val('appMotivation') || '';

  // CV filename — get from the file input if available
  const cvInput    = document.getElementById('cvFile');
  const cvFilename = cvInput?.files?.[0]?.name || 'Not uploaded';

  // ── Job fields ────────────────────────────────────────────────────────────
  const jobTitle    = job?.title    || 'Unknown Role';
  const jobDept     = job?.dept     || 'Unknown Department';
  const jobTags     = Array.isArray(job?.tags) ? job.tags.join(', ') : (job?.tags || '');
  const jobSalary   = job?.salary   || 'Not specified';
  const jobLocation = job?.locLabel || job?.loc || 'Not specified';

  const appliedDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // ── Build the structured plain-text body ─────────────────────────────────
  const body = `New application received via acquiretalentpartners.com

Reference: ${ref}

---APPLICATION_DATA---
candidate_name: ${fullName}
candidate_email: ${email}
candidate_phone: ${phone}
candidate_location: ${location}
candidate_linkedin: ${linkedin}
salary_expectation: ${salary}
notice_period: ${notice}
experience_level: ${experience}
right_to_work: ${visa}
cv_filename: ${cvFilename}
source: ${source}
job_title: ${jobTitle}
job_department: ${jobDept}
job_tags: ${jobTags}
job_salary_range: ${jobSalary}
job_location: ${jobLocation}
applied_date: ${appliedDate}
---END_APPLICATION_DATA---

---MOTIVATION---
${motivation || 'No motivation statement provided.'}
---END_MOTIVATION---`;

  // ── POST to email server ──────────────────────────────────────────────────
  const response = await fetch(`${EMAIL_SERVER_URL}/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'simon@simonvalentine.com',
      toName: 'Simon Valentine',
      subject: `[New Application] ${jobTitle} — ${fullName}`,
      html: `<pre style="font-family:monospace;font-size:13px;">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`,
      templateName: 'new-application-notification'
    })
  });

  if (!response.ok) {
    console.error('[ATS] Email send failed:', await response.text());
    // Don't throw — we don't want to block the success screen over an email failure
  } else {
    console.log('[ATS] Application email sent for:', fullName);
  }
}
