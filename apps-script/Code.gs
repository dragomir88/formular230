/**
 * Google Apps Script – Formular 230 Backend
 * ============================================
 * This script acts as a REST API endpoint for the Form 230 web page.
 * It receives POST requests, stores data in a Google Sheet (as Excel-compatible),
 * and saves the signature image as a thumbnail in the sheet.
 *
 * DEPLOYMENT STEPS (one-time setup):
 *  1. Go to https://script.google.com and create a new project.
 *  2. Paste this entire file content into the editor.
 *  3. Replace SPREADSHEET_ID below with your Google Sheet ID.
 *  4. Click Deploy > New Deployment > Web App.
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  5. Copy the Web App URL and paste it into index.html as APPS_SCRIPT_URL.
 */

// ── CONFIG ──────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1Ayz5XznFmYxzQsak04tLalmSV9X5LAu8ayhZqLX2bns';
const SHEET_NAME     = 'Formular230';

// Column headers (order matters – matches payload keys)
const HEADERS = [
  'Timestamp', 'Nume', 'Prenume', 'Inițiala tatălui',
  'CNP', 'Email', 'Telefon',
  'Strada', 'Număr', 'Bloc', 'Scară', 'Etaj', 'Apartament',
  'Județ/Sector', 'Localitate',
  'Entitate beneficiară', 'CIF entitate', 'IBAN entitate',
  'Opțiune 2 ani',
  'Semnătură (link)'
];

// ── CORS HELPER ──────────────────────────────────────────────────────────────
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Handle GET requests – used by admin page to fetch all rows
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'getAll') {
    try {
      const sheet = getOrCreateSheet();
      const data  = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return corsResponse({ status: 'ok', headers: HEADERS, rows: [] });
      }
      const headers = data[0];
      const rows    = data.slice(1);
      return corsResponse({ status: 'ok', headers, rows });
    } catch (err) {
      return corsResponse({ status: 'error', message: err.toString() });
    }
  }

  if (action === 'getSignature') {
    try {
      const fileUrl = e.parameter.url;
      if (!fileUrl) return corsResponse({ status: 'error', message: 'Missing url param' });
      // Extract file ID from Drive URL
      const match = fileUrl.match(/[-\w]{25,}/);
      if (!match) return corsResponse({ status: 'error', message: 'Invalid Drive URL' });
      const file = DriveApp.getFileById(match[0]);
      const blob = file.getBlob();
      const b64  = Utilities.base64Encode(blob.getBytes());
      return corsResponse({ status: 'ok', base64: b64, mimeType: blob.getContentType() });
    } catch (err) {
      return corsResponse({ status: 'error', message: err.toString() });
    }
  }

  return corsResponse({ status: 'ok', message: 'Formular 230 API is running.' });
}

// ── MAIN POST HANDLER ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet   = getOrCreateSheet();

    // Save signature image to Drive, get shareable URL
    let signatureUrl = '';
    if (payload.signature && payload.signature.startsWith('data:image')) {
      signatureUrl = saveSignatureImage(payload, sheet.getLastRow());
    }

    // Append row
    sheet.appendRow([
      payload.timestamp     || new Date().toISOString(),
      payload.lastName      || '',
      payload.firstName     || '',
      payload.fatherInitial || '',
      payload.cnp           || '',
      payload.email         || '',
      payload.phone         || '',
      payload.street        || '',
      payload.number        || '',
      payload.building      || '',
      payload.entrance      || '',
      payload.floor         || '',
      payload.apartment     || '',
      payload.county        || '',
      payload.city          || '',
      payload.entityName    || '',
      payload.entityCIF     || '',
      payload.entityIBAN    || '',
      payload.optiune2ani ? 'Da' : 'Nu',
      signatureUrl
    ]);

    // Auto-resize columns on first submission
    if (sheet.getLastRow() === 2) {
      sheet.autoResizeColumns(1, HEADERS.length);
    }

    // Send confirmation email
    if (payload.email) {
      sendConfirmationEmail(payload);
    }

    return corsResponse({ status: 'ok', message: 'Date înregistrate cu succes.' });

  } catch (err) {
    console.error(err);
    return corsResponse({ status: 'error', message: err.toString() });
  }
}

// ── SHEET HELPER ─────────────────────────────────────────────────────────────
function getOrCreateSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet   = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // Write headers
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#003DA5');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── SIGNATURE IMAGE SAVER ────────────────────────────────────────────────────
function saveSignatureImage(payload, rowIndex) {
  try {
    // Decode base64 PNG
    const base64Data = payload.signature.replace(/^data:image\/png;base64,/, '');
    const blob       = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      'image/png',
      `signature_${payload.cnp || rowIndex}_${Date.now()}.png`
    );

    // Save to a "Signatures" folder in Drive
    let folder;
    const folders = DriveApp.getFoldersByName('Formular230_Signatures');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Formular230_Signatures');

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    console.error('Signature save failed:', err);
    return 'error saving signature';
  }
}

// ── CONFIRMATION EMAIL ───────────────────────────────────────────────────────
function sendConfirmationEmail(payload) {
  try {
    const name    = `${payload.firstName} ${payload.lastName}`;
    const subject = 'Confirmare Formular 230 – Date înregistrate';
    const body    = `
Stimate(ă) ${name},

Datele dumneavoastră au fost înregistrate cu succes pentru Formularul 230.

Detalii transmise:
• Nume complet : ${name}
• CNP          : ${payload.cnp}
• Adresă       : Str. ${payload.street} nr. ${payload.number}, ${payload.city}, ${payload.county}
• Entitate     : ${payload.entityName} (CIF: ${payload.entityCIF})

Dacă nu ați completat acest formular, vă rugăm să ne contactați imediat.

Cu stimă,
Echipa organizației
    `.trim();

    MailApp.sendEmail({ to: payload.email, subject, body });
  } catch (err) {
    console.error('Email failed:', err);
  }
}
