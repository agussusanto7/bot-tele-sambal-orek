const { handleUpdate } = require('../src/bot');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            const body = req.body;
            await handleUpdate(body);
            res.status(200).send('OK');
        } else {
            res.status(200).send('Webhook is running');
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};
