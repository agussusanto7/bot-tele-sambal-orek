const fs = require('fs');

const token = '8471477013:AAGt5huOgwTFCT2HKqZ-OIAOEDWEac_ciPc';
const filePath = 'F:/Website/bot telgram sambel orek/assets/logo.jpg';

async function setProfilePhoto() {
    try {
        const formData = new FormData();
        formData.append('photo', JSON.stringify({ type: 'static', photo: 'attach://logo' }));
        
        const fileBuffer = fs.readFileSync(filePath);
        // Convert Buffer to Blob for fetch API
        const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
        formData.append('logo', blob, 'logo.jpg');

        const response = await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        console.log("Result:", result);
    } catch (e) {
        console.error("Error:", e);
    }
}

setProfilePhoto();
