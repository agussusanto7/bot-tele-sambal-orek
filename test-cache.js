require('dotenv').config();
const { google } = require('googleapis');
const SPREADSHEET_ID = '1Wh_uT2o9_WP66JxJQC9mGf_Q1NjuOVP5tjBFXHNpZNM';
const path = require('path');
const CREDENTIALS_PATH = path.resolve(__dirname, 'google-credentials.json');

function getGoogleAuthOptions(scopes) {
    if (process.env.GOOGLE_CREDENTIALS) {
        return { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes };
    }
    return { keyFile: CREDENTIALS_PATH, scopes };
}

async function test() {
    const auth = new google.auth.GoogleAuth(getGoogleAuthOptions(['https://www.googleapis.com/auth/spreadsheets']));
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // Ensure CACHE sheet exists
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const exists = res.data.sheets.some(s => s.properties.title === 'CACHE');
        if (!exists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests: [{ addSheet: { properties: { title: 'CACHE' } } }] }
            });
            console.log("Created CACHE sheet");
        } else {
            console.log("CACHE sheet exists");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}
test();
