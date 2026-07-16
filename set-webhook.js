require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let VERCEL_URL = process.argv[2]; // url passed from terminal

if (VERCEL_URL && VERCEL_URL.endsWith('/')) {
    VERCEL_URL = VERCEL_URL.slice(0, -1);
}

if (!VERCEL_URL) {
    console.error("❌ ERROR: Masukkan URL Vercel Anda!");
    console.log("Contoh: node set-webhook.js https://bot-saya.vercel.app");
    process.exit(1);
}

const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${VERCEL_URL}/api/webhook`;

fetch(url)
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            console.log("✅ Webhook berhasil dipasang ke:", VERCEL_URL);
            console.log("✅ Bot Anda sekarang berjalan di server Vercel!");
        } else {
            console.error("❌ Gagal memasang webhook:", data);
        }
    })
    .catch(err => console.error("❌ Error:", err));
