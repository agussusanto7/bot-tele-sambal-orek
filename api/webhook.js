const bot = require('../src/bot');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Meneruskan request dari Telegram ke sistem Bot kita
            bot.processUpdate(req.body);
            res.status(200).send('OK');
        } else {
            res.status(200).send('Webhook Bot Telegram Sambal Orek Aktif! 🚀');
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};
