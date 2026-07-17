require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);

const webhookUrl = process.argv[2];

if (!webhookUrl) {
    console.error("❌ Masukkan URL webhook. Contoh: node set-webhook.js https://namabot.vercel.app");
    process.exit(1);
}

const fullUrl = webhookUrl.endsWith('/api/webhook') ? webhookUrl : `${webhookUrl}/api/webhook`;

bot.setWebHook(fullUrl).then(() => {
    console.log(`✅ Webhook berhasil dipasang ke: ${fullUrl}`);
    console.log("✅ Bot Anda sekarang berjalan di server Vercel!");
}).catch(err => {
    console.error("❌ Gagal memasang webhook:", err.message);
});
