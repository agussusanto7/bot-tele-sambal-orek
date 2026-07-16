const bot = require('../src/bot');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Meneruskan request dari Telegram ke sistem Bot kita
            bot.processUpdate(req.body);
            
            // Vercel mematikan proses segera setelah res.send() dipanggil.
            // Oleh karena itu, kita tunda balasannya selama 8 detik 
            // agar bot punya cukup waktu untuk memanggil AI Gemini dan menyimpan ke Sheets.
            setTimeout(() => {
                res.status(200).send('OK');
            }, 8000);
        } else {
            res.status(200).send('Webhook Bot Telegram Sambal Orek Aktif! 🚀');
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};
