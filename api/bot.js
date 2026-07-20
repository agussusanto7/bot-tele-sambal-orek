const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

let bot = null;
let model = null;
let chatModel = null;
let initError = null;

const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'google-credentials.json');
const greetingPatterns = /^(hai|halo|hello|hi|hey|test|ping|pagi|siang|sore|malam|assalamualaikum|woi|prabowo|tes|cd|cde|hidelo|helooo?)$/i;
const mediaGroups = {};

const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

function getGoogleAuthOptions(scopes) {
    if (process.env.GOOGLE_CREDENTIALS) {
        return { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes };
    }
    return { keyFile: CREDENTIALS_PATH, scopes };
}

function initializeGlobals() {
    if (bot && model && chatModel) return;

    if (!process.env.TELEGRAM_BOT_TOKEN) {
        throw new Error("TELEGRAM_BOT_TOKEN belum disetting di Environment Variables Vercel.");
    }
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY belum disetting di Environment Variables Vercel.");
    }

    let rawToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (rawToken.startsWith('=')) rawToken = rawToken.substring(1).trim();

    let rawApiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (rawApiKey.startsWith('=')) rawApiKey = rawApiKey.substring(1).trim();

    bot = new TelegramBot(rawToken);

    const genAI = new GoogleGenerativeAI(rawApiKey);
    model = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite",
        systemInstruction: `Kamu adalah asisten pengatur keuangan warung (Kasir) bernama Sambal Orek.
Tugas utamamu adalah: Mengekstrak data dari nota kasir (baik manual maupun struk digital/Olsera).

Wajib kembalikan format JSON murni TANPA markdown (\`\`\`json).
Format JSON:
{
  "action": "rekapan",
  "data": {
    "order_date": "YYYY-MM-DD",
    "order_time": "HH:MM:SS",
    "order_no": "nomor urut struk/order (jika ada)",
    "no_nota": "nomor nota manual yang ditulis tangan (jika ada, tanpa 0 di depan)",
    "kasir": "nama kasir",
    "payment_mode": "CASH / QRIS / TF BUKOPIN / GOJEK / GRAB / dll",
    "nett_profit": "total penjualan bersih (hanya angka)"
  }
}
Jika ada 2 gambar (nota manual dan struk), gabungkan datanya (misal ambil no_nota dari gambar manual, dan order_no dari gambar struk).`
    });

    chatModel = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite",
        systemInstruction: "Kamu adalah asisten kasir warung 'Sambal Orek' yang ramah, sopan, dan sigap. Kamu akan menjawab pertanyaan pemilik terkait rekapan penjualan hari ini."
    });
}

// Coba inisialisasi awal, tapi tangkap errornya
try {
    initializeGlobals();
} catch (err) {
    initError = err;
}


async function getGoogleServices() {
    try {
        const auth = new google.auth.GoogleAuth(
            getGoogleAuthOptions(['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file'])
        );
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const drive = google.drive({ version: 'v3', auth: client });
        return { sheets, drive, client };
    } catch (error) {
        console.error("Auth error:", error.message);
        return null;
    }
}

async function getDailySpreadsheetId(chatId = null) {
    const services = await getGoogleServices();
    if (!services) return null;
    const { sheets, drive } = services;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const expectedName = `Rekapan Sambal Orek - ${todayStr}`;
    
    // Search in Google Drive for today's spreadsheet
    try {
        const res = await drive.files.list({
            q: `name = '${expectedName}' and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });
        
        if (res.data.files && res.data.files.length > 0) {
            // Found it!
            return res.data.files[0].id;
        }
    } catch (e) {
        console.error("Error searching drive:", e);
    }

    // If not found, create new spreadsheet
    try {
        const newSpreadsheet = await sheets.spreadsheets.create({
            resource: {
                properties: { title: expectedName },
                sheets: [{ properties: { title: 'REPORT' } }]
            }
        });
        const newId = newSpreadsheet.data.spreadsheetId;

        await drive.permissions.create({
            fileId: newId,
            resource: { type: 'anyone', role: 'writer' }
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: newId,
            range: 'REPORT!A1:J1',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [['Order No', 'No Nota', 'Tanggal', 'Jam', 'Kasir', 'Nett Profit', 'Payment Mode', 'CASH', 'QRIS', 'TF']]
            }
        });

        if (chatId) {
            await bot.sendMessage(chatId, `📄 *File Excel Baru Dibuat*\n\nTanggal: ${todayStr}\nLink: https://docs.google.com/spreadsheets/d/${newId}`, { parse_mode: 'Markdown' });
        }

        return newId;
    } catch (e) {
        console.error("Error creating daily spreadsheet:", e);
        return null;
    }
}

async function fetchSheetData(chatId = null) {
    const services = await getGoogleServices();
    if (!services) return null;
    const dailyId = await getDailySpreadsheetId(chatId);
    if (!dailyId) return null;

    try {
        const response = await services.sheets.spreadsheets.values.get({
            spreadsheetId: dailyId,
            range: 'REPORT!A:J',
        });
        return response.data.values;
    } catch (error) {
        console.error("Sheets fetch error:", error.message);
        return null;
    }
}

async function simpanKeSpreadsheet(data, chatId = null) {
    try {
        const services = await getGoogleServices();
        if (!services) return false;
        
        const sheets = services.sheets;
        const spreadsheetId = await getDailySpreadsheetId(chatId);
        if (!spreadsheetId) {
            console.error("No spreadsheet available.");
            return false;
        }

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

        // Dapatkan Sheet ID untuk sheet 'REPORT'
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
        const sheet = spreadsheetInfo.data.sheets.find(s => s.properties.title === 'REPORT');
        const sheetId = sheet ? sheet.properties.sheetId : 0;

        // Insert baris baru di posisi paling atas (baris ke-2 / index 1)
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    {
                        insertDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: "ROWS",
                                startIndex: 1,
                                endIndex: 2
                            },
                            inheritFromBefore: false
                        }
                    }
                ]
            }
        });

        // Tulis data ke baris ke-2 (yang baru saja dibuat)
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'REPORT!A2:J2',
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });

        return true;
    } catch (error) {
        console.error("❌ Error Google Sheets:", error);
        return false;
    }
}

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

            const isSaved = await simpanKeSpreadsheet(data, chatId);

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

async function handleMediaGroup(chatId, mediaGroupId, fileId) {
    const services = await getGoogleServices();
    if (!services) {
        await processPhotos(chatId, [fileId]);
        return;
    }
    const { sheets } = services;
    const dailyId = await getDailySpreadsheetId(chatId);
    if (!dailyId) {
        await processPhotos(chatId, [fileId]);
        return;
    }
    
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: dailyId });
        const exists = res.data.sheets.some(s => s.properties.title === 'CACHE');
        if (!exists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: dailyId,
                resource: { requests: [{ addSheet: { properties: { title: 'CACHE' } } }] }
            });
        }
    } catch (e) {
        console.error("Error creating CACHE sheet:", e);
    }
    
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: dailyId,
            range: 'CACHE!A:B',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[mediaGroupId, fileId]] },
        });
    } catch (e) {
        console.error("Error appending to CACHE:", e);
        await processPhotos(chatId, [fileId]);
        return;
    }
    
    // Cek ada berapa foto dalam album ini di CACHE
    let groupFiles = [];
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: dailyId,
            range: 'CACHE!A:B',
        });
        const rows = response.data.values || [];
        
        for (const row of rows) {
            if (row[0] === mediaGroupId) {
                groupFiles.push(row[1]);
            }
        }
    } catch (e) {
        console.error("Error reading CACHE:", e);
        await processPhotos(chatId, [fileId]);
        return;
    }
    
    // Logika Trigger Vercel-Telegram:
    // Telegram mengirim album satu per satu. 
    // Foto 1 masuk -> CACHE = 1 -> Jangan diproses dulu (kembalikan OK agar Telegram mengirim Foto 2)
    // Foto 2 masuk -> CACHE = 2 -> KEDUA foto diproses bersamaan!
    if (groupFiles.length === 1) {
        await bot.sendMessage(chatId, "📸 Menerima album foto 1/2, menunggu foto selanjutnya...");
        // Selesai di sini. Vercel mati, Telegram akan mengirim foto kedua.
    } else if (groupFiles.length >= 2) {
        await bot.sendMessage(chatId, `📸 Menerima album lengkap (${groupFiles.length} lembar), sedang menyatukan data...`);
        // Karena ini foto kedua/terakhir, kita proses semua foto dalam album!
        await processPhotos(chatId, groupFiles);
    }
}

// ==========================================
// FUNGSI UTAMA UNTUK VERCEL SERVERLESS
// ==========================================
module.exports = async function handleUpdate(req, res) {
    if (req.method !== 'POST') {
        if (initError) {
            return res.status(200).send(`Init Error: ${initError.message}\n\nPastikan Anda sudah menyetting TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY di Vercel.`);
        }
        const tokenDebug = process.env.TELEGRAM_BOT_TOKEN || '';
        return res.status(200).send('Webhook is running. Token length: ' + tokenDebug.length + ' Starts with: ' + tokenDebug.substring(0, 4));
    }

    try {
        // Coba init ulang jika sebelumnya gagal, karena request ini mungkin di Vercel yg sudah disetting env-nya
        if (initError || !bot) {
            try {
                initializeGlobals();
                initError = null; // berhasil init
            } catch (retryErr) {
                // Return 200 supaya Telegram tidak retry terus-terusan
                return res.status(200).send(`Bot gagal menyala: ${retryErr.message}`);
            }
        }

        const body = req.body;
        if (!body || !body.message) {
            return res.status(200).send('OK');
        }

        const msg = body.message;
        const chatId = msg.chat.id;
        const text = msg.text || msg.caption || '';

        // COMMAND: /start
        if (text.startsWith('/start')) {
            const welcomeMsg = `Halo! 👋 Selamat datang di *Bot Kasir Sambal Orek*.\n\nSaya di sini untuk membantu Anda merekap data harian secara otomatis ke Google Sheets.\n\n*📌 Fitur yang tersedia:*\n1️⃣ *Kirim Foto Nota* 📸\nKirimkan foto *Nota Manual* atau *Struk Olsera*. Anda juga bisa mengirim 2 foto sekaligus (album) untuk digabungkan datanya otomatis.\n\n2️⃣ */report* 📊\nUntuk melihat ringkasan pemasukan hari ini (Cash, QRIS, TF).\n\n3️⃣ */export* 📄\nUntuk mengunduh laporan lengkap dalam format *PDF* dan *Excel*.\n\n4️⃣ *Tanya AI* 🤖\nAnda bisa menanyakan langsung apa saja seputar data penjualan hari ini, misal: _"Berapa total pemasukan cash hari ini?"_\n\nKirimkan foto nota pertama Anda untuk mulai!`;
            await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
            return res.status(200).send('OK');
        }

        // COMMAND: /report
        if (text.startsWith('/report')) {
            await bot.sendMessage(chatId, "⏳ Menghitung laporan harian dari Spreadsheet...");
            const services = await getGoogleServices();
            if (!services) {
                await bot.sendMessage(chatId, "❌ Gagal mengontak Google Sheets.");
                return res.status(200).send('OK');
            }

            const dailyId = await getDailySpreadsheetId(chatId);
            const spreadsheetId = dailyId || SPREADSHEET_ID;

            const response = await services.sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'REPORT!A:J',
            });
            const rows = response.data.values;

            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayStr = `${yyyy}-${mm}-${dd}`;
            const displayDate = `${mm}/${dd}/${String(yyyy).slice(-2)}`;

            let totalCash = 0;
            let totalQris = 0;
            let totalTF = 0;

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
            return res.status(200).send('OK');
        }

        // COMMAND: /export
        if (text.startsWith('/export')) {
            await bot.sendMessage(chatId, "⏳ Sedang menyiapkan file PDF dan Excel Anda...");
            try {
                const services = await getGoogleServices();
                const dailyId = await getDailySpreadsheetId(chatId);
                const spreadsheetIdToExport = dailyId || SPREADSHEET_ID;

                const tokenResp = await services.client.getAccessToken();
                const tokenVal = tokenResp.token;
                const dateStr = new Date().toISOString().split('T')[0];

                const pdfUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetIdToExport}/export?format=pdf`;
                const pdfRes = await fetch(pdfUrl, { headers: { 'Authorization': 'Bearer ' + tokenVal } });
                const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
                await bot.sendDocument(chatId, pdfBuffer, { caption: '📄 Laporan Rekapan (PDF)' }, { filename: `Rekapan_${dateStr}.pdf`, contentType: 'application/pdf' });

                const excelUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetIdToExport}/export?format=xlsx`;
                const excelRes = await fetch(excelUrl, { headers: { 'Authorization': 'Bearer ' + tokenVal } });
                const excelBuffer = Buffer.from(await excelRes.arrayBuffer());
                await bot.sendDocument(chatId, excelBuffer, { caption: '📊 Laporan Rekapan (Excel)' }, { filename: `Rekapan_${dateStr}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            } catch (error) {
                console.error("Export Error:", error);
                await bot.sendMessage(chatId, "❌ Gagal mengunduh file laporan.");
            }
            return res.status(200).send('OK');
        }

        // FOTO
        if (msg.photo) {
            // SOLUSI VERCEL: Jika user membalas (reply) foto sebelumnya dengan foto baru
            if (msg.reply_to_message && msg.reply_to_message.photo) {
                await bot.sendMessage(chatId, "📸 Membaca 2 foto sekaligus (dari reply)...");
                const fileId1 = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
                const fileId2 = msg.photo[msg.photo.length - 1].file_id;
                await processPhotos(chatId, [fileId1, fileId2]);
                return res.status(200).send('OK');
            }

            if (msg.media_group_id) {
                await handleMediaGroup(chatId, msg.media_group_id, msg.photo[msg.photo.length - 1].file_id);
                return res.status(200).send('OK');
            } else {
                await bot.sendMessage(chatId, "🔍 Membaca dan mencocokkan nota...");
                await processPhotos(chatId, [msg.photo[msg.photo.length - 1].file_id]);
                return res.status(200).send('OK');
            }
        }

        // TEKS / CHAT AI
        if (msg.text && !msg.text.startsWith('/')) {
            if (greetingPatterns.test(msg.text.trim())) {
                const welcomeMsg = `Halo! 👋 Selamat datang di *Bot Kasir Sambal Orek*.\n\nSaya di sini untuk membantu Anda merekap data harian secara otomatis ke Google Sheets.\n\n*📌 Fitur yang tersedia:*\n1️⃣ *Kirim Foto Nota* 📸\nKirimkan foto *Nota Manual* atau *Struk Olsera*. Anda juga bisa mengirim 2 foto sekaligus (album) untuk digabungkan datanya otomatis.\n\n2️⃣ */report* 📊\nUntuk melihat ringkasan pemasukan hari ini (Cash, QRIS, TF).\n\n3️⃣ */export* 📄\nUntuk mengunduh laporan lengkap dalam format *PDF* dan *Excel*.\n\n4️⃣ *Tanya AI* 🤖\nAnda bisa menanyakan langsung apa saja seputar data penjualan hari ini, misal: _"Berapa total pemasukan cash hari ini?"_\n\nKirimkan foto nota pertama Anda untuk mulai!`;
                await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
                return res.status(200).send('OK');
            }

            try {
                const rows = await fetchSheetData(chatId);
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
            return res.status(200).send('OK');
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error("Unhandled message error:", err);
        // Mengirim error message kembali ke Telegram jika memungkinkan
        if (bot && req.body && req.body.message && req.body.message.chat) {
            try {
                await bot.sendMessage(req.body.message.chat.id, "❌ Terjadi Error Fatal di Vercel: \n" + err.message);
            } catch (e) { }
        }
        res.status(500).send('Error: ' + err.message + '\n' + err.stack);
    }
};