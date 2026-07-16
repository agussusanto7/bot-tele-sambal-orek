const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    // PERBAIKAN 1: Menggunakan model resmi yang didukung untuk pembacaan gambar (Vision)
    model: "gemini-3.1-flash-lite",

    // PERBAIKAN 2: Memaksa AI agar mutlak HANYA mengeluarkan JSON murni (mencegah error parse)
    generationConfig: {
        responseMimeType: "application/json",
    },

    systemInstruction: `Kamu adalah asisten kasir cerdas untuk "Warung Sambal Orek". 
Pengguna akan mengirimkan foto nota manual dan/atau struk dari sistem POS Olsera.

Tugasmu mengekstrak data persis seperti format tabel laporan. Ekstrak:
1. "order_no" (Nomor struk Olsera, cth: 94FF26071400015547)
2. "no_nota" (Nomor nota manual, cth: 3940)
3. "order_date" (Tanggal transaksi format YYYY-MM-DD, cth: 2026-07-14)
4. "order_time" (Waktu transaksi format HH:MM:SS, cth: 10:55:53)
5. "kasir" (Nama kasir, cth: Eki Doni Wiyoga)
6. "nett_profit" (Total harga bersih/Net Amount)
7. "payment_mode" (CASH / QRIS BSI / TF)

ATURAN PENTING:
Jika kamu menerima LEBIH DARI SATU gambar sekaligus (contoh: satu foto nota manual dan satu foto struk digital Olsera), kamu WAJIB menggabungkan data dari kedua gambar tersebut menjadi SATU laporan utuh yang saling melengkapi. (Contoh: Ambil "no_nota" dari nota manual, dan ambil "order_no", "order_time" dari struk Olsera).

Kembalikan HANYA format JSON valid TANPA markdown.
Format:
{
  "action": "rekapan",
  "data": {
    "order_no": "string",
    "no_nota": "string",
    "order_date": "string",
    "order_time": "string",
    "kasir": "string",
    "nett_profit": number,
    "payment_mode": "string"
  }
}`
});
const chatModel = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    systemInstruction: `Kamu adalah asisten pribadi warung "Sambal Orek" yang ramah dan estetik.
Tugasmu adalah menjawab pertanyaan pengguna berdasarkan data rekap penjualan (spreadsheet).
ATURAN FORMAT BALASAN (WAJIB DIIKUTI):
1. JANGAN gunakan tanda bintang (*) atau strip (-) untuk membuat list/daftar. Telegram akan error.
2. Gunakan EMOJI di awal baris sebagai pengganti bullet points (contoh: 📅, 💬, 🟢, 🕘).
3. Untuk teks tebal (bold), gunakan tanda bintang dua di awal dan akhir kata, contoh: **Total Pemasukan:**
4. Berikan spasi antar paragraf atau bagian agar rapi, persis seperti contoh berikut:

Halo! Senang bisa membantu Anda hari ini.
Berikut adalah data yang Anda minta:

🟢 **RINGKASAN DATA**
Total Transaksi: 10
Total Pemasukan: **Rp 900.000**

🕘 **TRANSAKSI TERAKHIR**
📅 Rabu, 15 Jul 2026 16:46
💬 **Rp 20.000** - Eki Doni Wiyoga (QRIS)

Apakah ada lagi yang bisa saya bantu terkait laporan ini?`
});

module.exports = { model, chatModel };