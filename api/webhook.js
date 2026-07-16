require('dotenv').config();
const bot = require('../src/bot');

// Vercel Hobi plan: 10 detik max execution time
// Strategy: jalankan bot dulu, baru kirim ACK
// Bot harus selesai dalam ~8 detik, sisanya untuk ACK + overhead
const BOT_PROCESS_TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Proses dengan timeout — bot harus selesai dalam 8 detik
            const timeoutPromise = new Promise(resolve => {
                setTimeout(resolve, BOT_PROCESS_TIMEOUT_MS);
            });

            const botPromise = bot.processUpdate(req.body).catch(err => {
                console.error("Bot processUpdate error:", err.message);
            });

            // Race antara bot selesai atau timeout
            await Promise.race([botPromise, timeoutPromise]);

            // Kirim ACK ke Telegram
            res.status(200).send('OK');
            return;
        } else {
            res.status(200).send('Webhook Bot Telegram Sambal Orek Aktif! 🚀');
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};
