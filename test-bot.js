require('dotenv').config();
const handler = require('./api/bot.js');

const req = {
    method: 'POST',
    body: {
        message: {
            chat: { id: 12345 },
            text: 'test'
        }
    }
};

const res = {
    status: (code) => {
        return {
            send: (msg) => console.log("Response:", code, msg)
        };
    }
};

handler(req, res).catch(console.error);
