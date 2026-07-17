require('dotenv').config();
const bot = require('../src/bot');

// Vercel Hobi plan: 10 detik max execution time
// Karena bot.processUpdate() mengembalikan promise yang resolve instan,
// kita perlu menunggu semua proses async bot selesai manual.
// Bot.js expose pendingProses untuk tracking.
const MAX_WAIT_MS = 8000;

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            const startTime = Date.now();

            // Dispatch ke bot (sync, tidak menunggu selesai)
            bot.processUpdate(req.body);

            // Tahan function hidup sampai semua proses async bot selesai
            const waitUntilDone = new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (bot.allProcessesDone()) {
                        clearInterval(checkInterval);
                        resolve();
                    } else if ((Date.now() - startTime) > MAX_WAIT_MS) {
                        clearInterval(checkInterval);
                        resolve(); // Timeout — kirim ACK
                    }
                }, 500);
            });

            await waitUntilDone;

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
