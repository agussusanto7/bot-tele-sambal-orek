require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const CREDENTIALS_PATH = path.resolve(__dirname, 'google-credentials.json');

function getGoogleAuthOptions(scopes) {
    if (process.env.GOOGLE_CREDENTIALS) {
        return { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes };
    }
    return { keyFile: CREDENTIALS_PATH, scopes };
}

async function testDrive() {
    try {
        const auth = new google.auth.GoogleAuth(
            getGoogleAuthOptions(['https://www.googleapis.com/auth/drive'])
        );
        const client = await auth.getClient();
        const drive = google.drive({ version: 'v3', auth: client });
        
        console.log("Emptying trash...");
        await drive.files.emptyTrash();
        console.log("Trash emptied!");

        const res = await drive.files.list({
            q: "",
            fields: 'files(id, name, size)'
        });
        console.log("Total files:", res.data.files.length);
        if (res.data.files.length > 0) {
            console.log("Sample files:", res.data.files.slice(0, 5));
        }

    } catch (e) {
        console.error("Error Detail:", JSON.stringify(e.response?.data?.error || e.message, null, 2));
    }
}

testDrive();
