require('dotenv').config();

const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Sambal Orek is Running (No Firebase)!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web Server berjalan di port ${PORT}`);
});

require('./src/bot.js');