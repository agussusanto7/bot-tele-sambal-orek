const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const xlsx = require('xlsx');

let bot = null;
let model = null;
let chatModel = null;
let db = null;
let initError = null;

const FIREBASE_CREDENTIALS_PATH = path.resolve(__dirname, '..', 'firebase-credentials.json');
const greetingPatterns = /^(hai|halo|hello|hi|hey|test|ping|pagi|siang|sore|malam|assalamualaikum|woi|prabowo|tes|cd|cde|hidelo|helooo?)$/i;

const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

function initializeGlobals() {
    if (bot && model && chatModel && db) return;

    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum disetting.");
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY belum disetting.");

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
  "data": [
    {
      "order_date": "YYYY-MM-DD",
      "order_time": "HH:MM:SS",
      "order_no": "nomor urut struk/order (jika ada)",
      "no_nota": "nomor nota manual yang ditulis tangan (jika ada, tanpa 0 di depan)",
      "kasir": "nama kasir",
      "payment_mode": "CASH / QRIS / TF BUKOPIN / GOJEK / GRAB / dll",
      "nett_profit": "total penjualan bersih (hanya angka)"
    }
  ]
}
Jika foto-foto tersebut adalah pasangan nota manual & struk digital dari pesanan yang sama, gabungkan jadi 1 objek. Jika dari pesanan berbeda, pisahkan jadi beberapa objek dalam array.`
    });

    chatModel = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite",
        systemInstruction: "Kamu adalah asisten kasir warung 'Sambal Orek' yang ramah, sopan, dan sigap. Kamu akan menjawab pertanyaan pemilik terkait rekapan penjualan hari ini."
    });

    if (admin.getApps().length === 0) {
        let cert;
        if (process.env.FIREBASE_CREDENTIALS) {
            cert = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        } else {
            cert = require(FIREBASE_CREDENTIALS_PATH);
        }
        admin.initializeApp({ credential: admin.cert(cert) });
    }
    db = getFirestore();
}

try {
    initializeGlobals();
} catch (err) {
    initError = err;
}

const parseRupiah = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return parseFloat(val.toString().replace(/[^0-9.-]+/g, "")) || 0;
}

async function simpanKeFirestore(data) {
    try {
        const paymentModeStr = (data.payment_mode || "").toUpperCase();
        const nett = parseRupiah(data.nett_profit);
        let cash = paymentModeStr.includes('CASH') ? nett : 0;
        let qris = paymentModeStr.includes('QRIS') ? nett : 0;
        let tf = (paymentModeStr.includes('TF') || paymentModeStr.includes('GOJEK') || paymentModeStr.includes('GRAB')) ? nett : 0;

        const sysDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

        const docData = {
            order_no: data.order_no || "-",
            no_nota: data.no_nota || "-",
            order_date: data.order_date || "-",
            order_time: data.order_time || "-",
            kasir: data.kasir || "-",
            nett_profit: nett,
            payment_mode: data.payment_mode || "-",
            cash: cash,
            qris: qris,
            tf: tf,
            sys_date: sysDate,
            createdAt: FieldValue.serverTimestamp()
        };

        await db.collection('transactions').add(docData);
        return true;
    } catch (error) {
        console.error("❌ Error Firestore:", error);
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

        const prompt = `Tolong ekstrak data dari kumpulan foto nota/struk ini.
PENTING:
- Jika ada nota manual dan struk digital untuk TRANSAKSI YANG SAMA, GABUNGKAN datanya menjadi 1 transaksi utuh.
- Jika ada foto untuk TRANSAKSI YANG BERBEDA, pisahkan menjadi transaksi yang berbeda.
- Kembalikan hasilnya selalu dalam bentuk ARRAY dari objek transaksi.`;
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

        let dataArray = parsedData.data;
        if (!Array.isArray(dataArray)) {
            dataArray = [dataArray];
        }

        if (parsedData.action === 'rekapan') {
            await bot.sendMessage(chatId, `⏳ Data terbaca (${dataArray.length} transaksi), sedang menyimpan ke Database Firebase...`);

            let successCount = 0;
            let reply = "";

            if (dataArray.length === 1) {
                // Formatting khusus untuk 1 transaksi (Lebih luwes, tanpa nomor urut)
                let data = dataArray[0];
                if (data && data.no_nota && typeof data.no_nota === 'string') {
                    data.no_nota = data.no_nota.replace(/^0+/, '');
                }

                const isSaved = await simpanKeFirestore(data);
                if (isSaved) {
                    reply += `✅ **Data Berhasil Disimpan!**\n` +
                        `👤 Kasir: ${data.kasir || '-'}\n` +
                        `🧾 Nota: ${data.no_nota || '-'} | 📠 Order: ${data.order_no || '-'}\n` +
                        `💳 ${data.payment_mode || '-'} - 💰 ${formatRp(parseRupiah(data.nett_profit))}`;
                } else {
                    reply += `❌ **Gagal Menyimpan Data**\nSilakan coba lagi.`;
                }
            } else {
                // Formatting untuk banyak transaksi (Batch)
                reply = `*Hasil Rekap (${dataArray.length} Data)*\n\n`;
                for (let i = 0; i < dataArray.length; i++) {
                    let data = dataArray[i];
                    if (data && data.no_nota && typeof data.no_nota === 'string') {
                        data.no_nota = data.no_nota.replace(/^0+/, '');
                    }

                    const isSaved = await simpanKeFirestore(data);
                    if (isSaved) successCount++;

                    const saveStatusMsg = isSaved ? "✅ Tersimpan" : "❌ Gagal";

                    reply += `**Data ${i + 1}** [${saveStatusMsg}]\n` +
                        `👤 Kasir: ${data.kasir || '-'}\n` +
                        `🧾 Nota: ${data.no_nota || '-'} | 📠 Order: ${data.order_no || '-'}\n` +
                        `💳 ${data.payment_mode || '-'} - 💰 ${formatRp(parseRupiah(data.nett_profit))}\n\n`;
                }
                reply += `📝 *Berhasil menyimpan ${successCount} dari ${dataArray.length} transaksi.*`;
            }

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
    if (!db) {
        await processPhotos(chatId, [fileId]);
        return;
    }
    
    try {
        const docRef = db.collection('media_cache').doc(mediaGroupId);
        
        let isFirst = false;
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) {
                t.set(docRef, { 
                    files: [fileId], 
                    updatedAt: FieldValue.serverTimestamp() 
                });
                isFirst = true;
            } else {
                t.update(docRef, {
                    files: FieldValue.arrayUnion(fileId),
                    updatedAt: FieldValue.serverTimestamp()
                });
                isFirst = false;
            }
        });
        
        if (isFirst) {
            await bot.sendMessage(chatId, "📸 Menerima album foto... sedang mengumpulkan (bot akan memproses otomatis setelah foto terakhir masuk)...");
            
            let groupFiles = [];
            let lastLength = 1;
            let unchangedCount = 0;
            
            // Polling maksimal 20 detik
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const currentDoc = await docRef.get();
                if (!currentDoc.exists) break;
                
                groupFiles = currentDoc.data().files || [];
                if (groupFiles.length > lastLength) {
                    lastLength = groupFiles.length;
                    unchangedCount = 0; // Reset jika ada foto baru masuk
                } else {
                    unchangedCount++;
                }
                
                // Jika sudah 3 detik berturut-turut tidak ada tambahan foto, anggap album selesai!
                if (unchangedCount >= 3) {
                    break;
                }
            }
            
            await bot.sendMessage(chatId, `📸 Memproses total ${groupFiles.length} foto sekaligus...`);
            await processPhotos(chatId, groupFiles);
            
            // Bersihkan cache
            await docRef.delete();
        } else {
            // Foto ke-2, 3, dst sudah ditambahkan ke array di dalam transaction di atas.
            // Tidak perlu melakukan apa-apa lagi.
        }
    } catch (e) {
        console.error("MediaGroup Error:", e);
        try {
            await bot.sendMessage(chatId, `⚠️ Debug Error (MediaGroup): ${e.message}`);
        } catch (err) {}
        await processPhotos(chatId, [fileId]);
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
        return res.status(200).send('Webhook is running.');
    }

    try {
        if (initError || !bot) {
            try {
                initializeGlobals();
                initError = null;
            } catch (retryErr) {
                if (bot && req.body && req.body.message && req.body.message.chat) {
                    bot.sendMessage(req.body.message.chat.id, `⚠️ Bot gagal menyala (Init Error): ${retryErr.message}`).catch(() => {});
                }
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
            const welcomeMsg = `Halo! 👋 Selamat datang di *Bot Kasir Sambal Orek*.\n\nSaya di sini untuk membantu Anda merekap data harian secara otomatis ke Database.\n\n*📌 Fitur yang tersedia:*\n1️⃣ *Kirim Foto Nota* 📸\nKirimkan foto *Nota Manual* atau *Struk Olsera*.\n\n2️⃣ */report* 📊\nUntuk melihat ringkasan pemasukan hari ini (Cash, QRIS, TF).\n\n3️⃣ */export* 📄\nUntuk mengunduh laporan Excel (.xlsx).\n\n4️⃣ *Tanya AI* 🤖\nTanyakan apa saja terkait rekap hari ini!\n\nKirimkan foto nota pertama Anda untuk mulai!`;
            await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
            return res.status(200).send('OK');
        }

        const sysDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
        const displayDate = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });

        // COMMAND: /report
        if (text.startsWith('/report')) {
            await bot.sendMessage(chatId, "⏳ Menghitung laporan harian dari Firebase...");
            try {
                const snapshot = await db.collection('transactions').where('sys_date', '==', sysDate).get();
                let totalCash = 0, totalQris = 0, totalTF = 0;
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    totalCash += data.cash || 0;
                    totalQris += data.qris || 0;
                    totalTF += data.tf || 0;
                });
                
                let totalAll = totalCash + totalQris + totalTF;
                const reportMessage = `
*Laporan Harian:* ${displayDate}
Cash \t\t${formatRp(totalCash)}
Qris \t\t${formatRp(totalQris)}
Total \t\t${formatRp(totalAll)}
Brankas \t${formatRp(totalCash)}
TF \t\t${formatRp(totalTF)}`;
                await bot.sendMessage(chatId, reportMessage.trim(), { parse_mode: 'Markdown' });
            } catch (err) {
                console.error("Report Error:", err);
                await bot.sendMessage(chatId, "❌ Gagal mengambil data dari Database.");
            }
            return res.status(200).send('OK');
        }

        // COMMAND: /export
        if (text.startsWith('/export')) {
            await bot.sendMessage(chatId, "⏳ Sedang merakit file Excel Anda secara otomatis...");
            try {
                const snapshot = await db.collection('transactions')
                    .where('sys_date', '==', sysDate)
                    .get();

                const docsData = [];
                snapshot.forEach(doc => docsData.push(doc.data()));
                
                // Urutkan berdasarkan waktu simpan
                docsData.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

                const rows = [['Order No', 'No Nota', 'Tanggal', 'Jam', 'Kasir', 'Nett Profit', 'Payment Mode', 'CASH', 'QRIS', 'TF']];
                
                docsData.forEach(data => {
                    const formatUang = (val) => {
                        const num = Number(val) || 0;
                        return num === 0 ? "" : `Rp ${num.toLocaleString('id-ID')}`;
                    };

                    rows.push([
                        data.order_no || "", 
                        data.no_nota || "", 
                        data.order_date || "", 
                        data.order_time || "", 
                        data.kasir || "",
                        formatUang(data.nett_profit), 
                        data.payment_mode || "", 
                        formatUang(data.cash), 
                        formatUang(data.qris), 
                        formatUang(data.tf)
                    ]);
                });

                const wb = xlsx.utils.book_new();
                const ws = xlsx.utils.aoa_to_sheet(rows);
                
                // Atur Lebar Kolom (Presisi)
                ws['!cols'] = [
                    {wch: 25}, // Order No
                    {wch: 15}, // No Nota
                    {wch: 12}, // Tanggal
                    {wch: 10}, // Jam
                    {wch: 22}, // Kasir
                    {wch: 18}, // Nett Profit
                    {wch: 15}, // Payment Mode
                    {wch: 18}, // CASH
                    {wch: 18}, // QRIS
                    {wch: 18}  // TF
                ];

                // Tambahkan style bold (didukung oleh beberapa software Excel)
                for (let c = 0; c < 10; c++) {
                    const cellRef = xlsx.utils.encode_cell({r: 0, c: c});
                    if (ws[cellRef]) {
                        ws[cellRef].s = { font: { bold: true } };
                    }
                }

                xlsx.utils.book_append_sheet(wb, ws, "REPORT");
                
                const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
                
                await bot.sendDocument(chatId, excelBuffer, { caption: `📊 Laporan Rekapan (Excel) - ${displayDate}` }, { filename: `Rekapan_${sysDate}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            } catch (error) {
                console.error("Export Error:", error);
                await bot.sendMessage(chatId, "❌ Gagal mengunduh file laporan Excel. Detail: " + error.message);
            }
            return res.status(200).send('OK');
        }

        // FOTO
        if (msg.photo) {
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
                await bot.sendMessage(chatId, "Halo! Kirimkan foto nota untuk merekap, ketik /report untuk ringkasan hari ini, atau ketik /export untuk download Excel.");
                return res.status(200).send('OK');
            }

            try {
                const snapshot = await db.collection('transactions').where('sys_date', '==', sysDate).get();
                let contextData = "Data kasir kosong.";
                
                if (!snapshot.empty) {
                    const rowStrings = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        rowStrings.push(`${data.order_no} | ${data.no_nota} | ${data.order_time} | ${data.kasir} | ${data.nett_profit} | ${data.payment_mode}`);
                    });
                    contextData = rowStrings.join('\n');
                }
                
                const prompt = `Berikut adalah data rekap penjualan (buku kas) warung Sambal Orek hari ini:\n\n${contextData}\n\nPesan pengguna: "${msg.text}"\n\nJawablah berdasarkan data di atas dengan singkat, jelas, dan ramah. Jika ada angka Rupiah, formatlah dengan rapi.`;
                const result = await chatModel.generateContent(prompt);
                let aiResponse = result.response.text();
                aiResponse = aiResponse.replace(/\*\*/g, '*');
                await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error("Error Q&A:", error.message);
                try {
                    const prompt = `Pesan pengguna: "${msg.text}". Data kasir hari ini tidak tersedia. Jawab ramah.`;
                    const result = await chatModel.generateContent(prompt);
                    let aiResponse = result.response.text();
                    aiResponse = aiResponse.replace(/\*\*/g, '*');
                    await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });
                } catch (e) {
                    await bot.sendMessage(chatId, "❌ Maaf, sistem sedang sibuk.");
                }
            }
            return res.status(200).send('OK');
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error("Unhandled message error:", err);
        if (bot && req.body && req.body.message && req.body.message.chat) {
            try {
                await bot.sendMessage(req.body.message.chat.id, "❌ Terjadi Error Fatal di Vercel: \n" + err.message);
            } catch (e) { }
        }
        res.status(500).send('Error: ' + err.message);
    }
};