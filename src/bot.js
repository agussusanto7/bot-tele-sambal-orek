const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const { model, chatModel } = require('./ai');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token); // TANPA POLLING UNTUK VERCEL

const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'google-credentials.json');
const SPREADSHEET_ID = '1Wh_uT2o9_WP66JxJQC9mGf_Q1NjuOVP5tjBFXHNpZNM';

function getGoogleAuthOptions(scopes) {
    if (process.env.GOOGLE_CREDENTIALS) {
        return { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes };
    }
    return { keyFile: CREDENTIALS_PATH, scopes };
}

const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

async function getSheetsClient() {
    try {
        const auth = new google.auth.GoogleAuth(
            getGoogleAuthOptions(['https://www.googleapis.com/auth/spreadsheets'])
        );
        const client = await auth.getClient();
        return google.sheets({ version: 'v4', auth: client });
    } catch (error) {
        console.error("Sheets auth error:", error.message);
        return null;
    }
}

async function fetchSheetData() {
    const sheets = await getSheetsClient();
    if (!sheets) return null;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'REPORT!A:J',
        });
        return response.data.values;
    } catch (error) {
        console.error("Sheets fetch error:", error.message);
        return null;
    }
}

const greetingPatterns = /^(hai|halo|hello|hi|hey|test|ping|pagi|siang|sore|malam|assalamualaikum|woi|prabowo|tes|cd|cde|hidelo|helooo?)$/i;

async function simpanKeSpreadsheet(data) {
    try {
        const auth = new google.auth.GoogleAuth(
            getGoogleAuthOptions(['https://www.googleapis.com/auth/spreadsheets'])
        );

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const spreadsheetId = SPREADSHEET_ID;

        const paymentModeStr = (data.payment_mode || "").toUpperCase();
        let cash = paymentModeStr.includes('CASH') ? data.nett_profit : "";
        let qris = paymentModeStr.includes('QRIS') ? data.nett_profit : "";
        let tf = paymentModeStr.includes('TF') ? data.nett_profit : "";

        const values = [
            [
                data.order_no || "-",
                data.no_nota || "-",
                data.order_date || "-",
                data.order_time || "-",
                data.kasir || "-",
                data.nett_profit || 0,
                data.payment_mode || "-",
                cash,
                qris,
                tf
            ]
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'REPORT!A:J',
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });

        return true;
    } catch (error) {
        console.error("❌ Error Google Sheets:", error);
        return false;
    }
}

const mediaGroups = {};

async function processPhotos(chatId, fileIds) {
    try {
        const imageParts = [];
        for (const fileId of fileIds) {
            const fileLink = await bot.getFileLink(fileId);
            const imageResp = await fetch(fileLink);
            const arrayBuffer = await imageResp.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            imageParts.push({
                inlineData: {
                    data: buffer.toString("base64"),
                    mimeType: "image/jpeg"
                }
            });
        }

        const prompt = "Tolong ekstrak data dari nota/struk ini. Jika ada lebih dari 1 gambar (misal nota manual dan struk digital), GABUNGKAN datanya menjadi SATU data rekap utuh yang saling melengkapi.";
        const result = await model.generateContent([prompt, ...imageParts]);
        const aiResponse = result.response.text();

        let parsedData;
        try {
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[0]);
            } else {
                const cleanJson = aiResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                parsedData = JSON.parse(cleanJson);
            }
        } catch (e) {
            console.error("AI Response error:", aiResponse);
            await bot.sendMessage(chatId, "❌ AI memberikan format balasan yang salah.");
            return;
        }

        const data = parsedData.data;

        if (data && data.no_nota && typeof data.no_nota === 'string') {
            data.no_nota = data.no_nota.replace(/^0+/, '');
        }

        if (parsedData.action === 'rekapan') {
            await bot.sendMessage(chatId, "⏳ Data terbaca, sedang menyimpan ke Google Sheets...");

            const isSaved = await simpanKeSpreadsheet(data);

            const saveStatusMsg = isSaved ?
                "\n_✅ Data berhasil disimpan ke Spreadsheet._" :
                "\n_❌ Gagal menyimpan ke Spreadsheet._";

            const reply = `*Hasil Pencocokan Nota*\n\n` +
                `📅 Tanggal: ${data.order_date || '-'}\n` +
                `⏰ Jam: ${data.order_time || '-'}\n` +
                `👤 Kasir: ${data.kasir || '-'}\n` +
                `🧾 No. Nota Manual: ${data.no_nota || '-'}\n` +
                `📠 No. Order Olsera: ${data.order_no || '-'}\n` +
                `💳 Metode: ${data.payment_mode || '-'}\n` +
                `💰 Total: ${formatRp(data.nett_profit || 0)}\n\n` +
                `📝 *Catatan AI:* Data diproses otomatis.` + saveStatusMsg;

            await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error("Error Processing Image(s):", error);
        if (error.message && (error.message.toLowerCase().includes('gemini') || error.message.toLowerCase().includes('google'))) {
            await bot.sendMessage(chatId, "❌ Server Gemini Error: API AI sedang bermasalah atau tidak tersambung. Detail: " + error.message);
        } else {
            await bot.sendMessage(chatId, "❌ Gagal memproses gambar. Pastikan tulisan pada nota terbaca dengan jelas. Detail: " + error.message);
        }
    }
}

// ==========================================
// FUNGSI UTAMA UNTUK VERCEL SERVERLESS
// ==========================================
async function handleUpdate(body) {
    if (!body.message) return;
    const msg = body.message;
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';

    try {
        // COMMAND: /start
        if (text.startsWith('/start')) {
            const welcomeMsg = `Halo! 👋 Selamat datang di *Bot Kasir Sambal Orek*.\n\nSaya di sini untuk membantu Anda merekap data harian secara otomatis ke Google Sheets.\n\n*📌 Fitur yang tersedia:*\n1️⃣ *Kirim Foto Nota* 📸\nKirimkan foto *Nota Manual* atau *Struk Olsera*. Anda juga bisa mengirim 2 foto sekaligus (album) untuk digabungkan datanya otomatis.\n\n2️⃣ */report* 📊\nUntuk melihat ringkasan pemasukan hari ini (Cash, QRIS, TF).\n\n3️⃣ */export* 📄\nUntuk mengunduh laporan lengkap dalam format *PDF* dan *Excel*.\n\n4️⃣ *Tanya AI* 🤖\nAnda bisa menanyakan langsung apa saja seputar data penjualan hari ini, misal: _"Berapa total pemasukan cash hari ini?"_\n\nKirimkan foto nota pertama Anda untuk mulai!`;
            await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
            return;
        }

        // COMMAND: /report
        if (text.startsWith('/report')) {
            await bot.sendMessage(chatId, "⏳ Menghitung laporan harian dari Spreadsheet...");
            const sheets = await getSheetsClient();
            if (!sheets) {
                await bot.sendMessage(chatId, "❌ Gagal mengontak Google Sheets.");
                return;
            }
            
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'REPORT!A:J',
            });
            const rows = response.data.values;
            
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayStr = `${yyyy}-${mm}-${dd}`;
            const displayDate = `${mm}/${dd}/${String(yyyy).slice(-2)}`;
            
            let totalCash = 0; let totalQris = 0; let totalTF = 0;
            
            if (rows && rows.length > 0) {
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const orderDate = String(row[2] || "");
                    if (orderDate.startsWith(todayStr) || orderDate.includes(todayStr)) {
                        const paymentMode = (row[6] || "").toUpperCase();
                        const nettProfit = parseFloat((row[5] || "0").replace(/[^0-9.-]+/g, ""));
                        if (paymentMode.includes('CASH')) totalCash += nettProfit;
                        else if (paymentMode.includes('QRIS')) totalQris += nettProfit;
                        else if (paymentMode.includes('TF') || paymentMode.includes('GOJEK')) totalTF += nettProfit;
                    }
                }
            }
            let totalAll = totalCash + totalQris + totalTF;
            const reportMessage = `
*Laporan Harian:* ${displayDate}
Cash \t\t${formatRp(totalCash)}
Qris \t\t${formatRp(totalQris)}
Total \t\t${formatRp(totalAll)}
Brankas \t${formatRp(totalCash)}
TF \t\t${formatRp(totalTF)}`;
            await bot.sendMessage(chatId, reportMessage.trim(), { parse_mode: 'Markdown' });
            return;
        }

        // COMMAND: /export
        if (text.startsWith('/export')) {
            await bot.sendMessage(chatId, "⏳ Sedang menyiapkan file PDF dan Excel Anda...");
            try {
                const auth = new google.auth.GoogleAuth(
                    getGoogleAuthOptions(['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'])
                );
                const client = await auth.getClient();
                const tokenResp = await client.getAccessToken();
                const tokenVal = tokenResp.token;
                const dateStr = new Date().toISOString().split('T')[0];
                
                const pdfUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf`;
                const pdfRes = await fetch(pdfUrl, { headers: { 'Authorization': 'Bearer ' + tokenVal } });
                const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
                await bot.sendDocument(chatId, pdfBuffer, { caption: '📄 Laporan Rekapan (PDF)' }, { filename: `Rekapan_${dateStr}.pdf`, contentType: 'application/pdf' });
                
                const excelUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
                const excelRes = await fetch(excelUrl, { headers: { 'Authorization': 'Bearer ' + tokenVal } });
                const excelBuffer = Buffer.from(await excelRes.arrayBuffer());
                await bot.sendDocument(chatId, excelBuffer, { caption: '📊 Laporan Rekapan (Excel)' }, { filename: `Rekapan_${dateStr}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            } catch (error) {
                console.error("Export Error:", error);
                await bot.sendMessage(chatId, "❌ Gagal mengunduh file laporan.");
            }
            return;
        }

        // FOTO
        if (msg.photo) {
            if (msg.media_group_id) {
                if (!mediaGroups[msg.media_group_id]) {
                    mediaGroups[msg.media_group_id] = [msg.photo[msg.photo.length - 1].file_id];
                    await bot.sendMessage(chatId, "📸 Menerima album foto, sedang menyatukan data nota...");
                    
                    // Tunggu 2.5 detik untuk Vercel mengumpulkan foto-foto lainnya (jika beruntung di instance yg sama)
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    
                    const fileIds = mediaGroups[msg.media_group_id];
                    delete mediaGroups[msg.media_group_id];
                    
                    if (fileIds && fileIds.length > 0) {
                        await processPhotos(chatId, fileIds);
                    }
                } else {
                    mediaGroups[msg.media_group_id].push(msg.photo[msg.photo.length - 1].file_id);
                }
                return;
            } else {
                await bot.sendMessage(chatId, "🔍 Membaca dan mencocokkan nota...");
                await processPhotos(chatId, [msg.photo[msg.photo.length - 1].file_id]);
                return;
            }
        } 
        
        // TEKS / CHAT AI
        if (msg.text && !msg.text.startsWith('/')) {
            if (greetingPatterns.test(msg.text.trim())) {
                const welcomeMsg = `Halo! 👋 Selamat datang di *Bot Kasir Sambal Orek*.\n\nSaya di sini untuk membantu Anda merekap data harian secara otomatis ke Google Sheets.\n\n*📌 Fitur yang tersedia:*\n1️⃣ *Kirim Foto Nota* 📸\nKirimkan foto *Nota Manual* atau *Struk Olsera*. Anda juga bisa mengirim 2 foto sekaligus (album) untuk digabungkan datanya otomatis.\n\n2️⃣ */report* 📊\nUntuk melihat ringkasan pemasukan hari ini (Cash, QRIS, TF).\n\n3️⃣ */export* 📄\nUntuk mengunduh laporan lengkap dalam format *PDF* dan *Excel*.\n\n4️⃣ *Tanya AI* 🤖\nAnda bisa menanyakan langsung apa saja seputar data penjualan hari ini, misal: _"Berapa total pemasukan cash hari ini?"_\n\nKirimkan foto nota pertama Anda untuk mulai!`;
                await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
                return;
            }

            try {
                const rows = await fetchSheetData();
                let contextData = "Data kasir kosong.";
                if (rows && rows.length > 0) {
                    contextData = rows.map(row => row.join(' | ')).join('\n');
                }
                const prompt = `Berikut adalah data rekap penjualan (buku kas) warung Sambal Orek:\n\n${contextData}\n\nPesan pengguna: "${msg.text}"\n\nJika pesan pengguna menanyakan data, jawablah berdasarkan data di atas dengan singkat, jelas, dan ramah. Jika tidak ada data relevan, jawab saja bahwa tidak ada data untuk pertanyaan itu. Jika ada angka Rupiah, formatlah dengan rapi.`;
                
                const result = await chatModel.generateContent(prompt);
                let aiResponse = result.response.text();
                aiResponse = aiResponse.replace(/\*\*/g, '*');
                await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error("Error Q&A:", error.message);
                try {
                    const prompt = `Pesan pengguna: "${msg.text}". Data sheets tidak tersedia (error). Jawab dengan ramah bahwa data kasir sedang tidak bisa diakses, tapi tetap tawarkan bantuan.`;
                    const result = await chatModel.generateContent(prompt);
                    let aiResponse = result.response.text();
                    aiResponse = aiResponse.replace(/\*\*/g, '*');
                    await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });
                } catch (fallbackError) {
                    await bot.sendMessage(chatId, "❌ Maaf, terjadi kesalahan. Detail: " + fallbackError.message);
                }
            }
        }

    } catch (err) {
        console.error("Unhandled message error:", err);
    }
}

module.exports = { handleUpdate };
