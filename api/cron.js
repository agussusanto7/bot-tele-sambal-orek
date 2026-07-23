const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const FIREBASE_CREDENTIALS_PATH = path.resolve(__dirname, '..', 'firebase-credentials.json');

module.exports = async function handler(req, res) {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN is not set" });
        }

        let rawToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
        if (rawToken.startsWith('=')) rawToken = rawToken.substring(1).trim();

        const bot = new TelegramBot(rawToken);

        if (admin.getApps().length === 0) {
            let cert;
            if (process.env.FIREBASE_CREDENTIALS) {
                cert = JSON.parse(process.env.FIREBASE_CREDENTIALS);
            } else {
                cert = require(FIREBASE_CREDENTIALS_PATH);
            }
            admin.initializeApp({ credential: admin.cert(cert) });
        }
        
        const db = getFirestore();

        // Ambil ID Chat dari database
        const configDoc = await db.collection('config').doc('admin').get();
        if (!configDoc.exists || !configDoc.data().chatId) {
            return res.status(404).json({ error: "Admin chat ID not found. Mohon ketik /start di bot." });
        }

        const chatId = configDoc.data().chatId;
        const pesanPagi = "☀️ *Pagi Bos!* \n\nJangan lupa untuk mencatat dan memfoto nota-nota kasir hari ini ya. Semangat jualannya! 🚀";

        await bot.sendMessage(chatId, pesanPagi, { parse_mode: 'Markdown' });
        
        res.status(200).json({ success: true, message: "Reminder sent successfully" });
    } catch (error) {
        console.error("Cron Error:", error);
        res.status(500).json({ error: error.message });
    }
};
