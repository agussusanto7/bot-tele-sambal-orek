require('dotenv').config();
const bot = require('../src/bot');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Meneruskan request dari Telegram ke sistem Bot kita
            bot.processUpdate(req.body);
            
            // Vercel mematikan proses segera setelah fungsi async ini selesai.
            // Oleh karena itu, kita HARUS menahan eksekusi selama 8 detik 
            // menggunakan promise agar bot punya cukup waktu untuk memanggil AI Gemini dan API Telegram.
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            res.status(200).send('OK');
        } else {
            res.status(200).send('Webhook Bot Telegram Sambal Orek Aktif! 🚀');
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};
