# Absensi Guru SMP ABBS Surakarta

Absensi guru: **login pakai akun LMS**, absen foto + GPS dalam radius sekolah,
rekap bulanan untuk admin dengan aturan **TOT** (tepat waktu ≤ batas jam).

Tanpa build step — HTML + CSS + JS biasa, host statis (GitHub Pages).

## Link

- Aplikasi: <https://smpabbs.github.io/absensi-guru-abbs/>
- Demo rekap (data contoh, tanpa login): <https://smpabbs.github.io/absensi-guru-abbs/?demo=1>

## Arsitektur

```
HP guru ──login──▶ Supabase LMS (drlsnhnqxkcgcuskswwx)
   │                 └─ auth: username → username@examfilq.dev → signIn
   └──data──▶ Edge Function "absen" (project abbs-chat-belajar)
                 ├─ verifikasi token LMS (GET /auth/v1/user)
                 ├─ validasi radius, jam, TOT, absen ganda
                 ├─ tabel absen_presensi / absen_pengaturan / absen_libur
                 └─ foto → bucket privat absensi-foto
```

Kenapa dua project: **data presensi dipisah** dari database LMS (tidak mencampuri
ujian/rapor), sementara akun tetap akun LMS asli. Karena token LMS tidak berlaku
di project lain, semua baca/tulis lewat satu Edge Function yang memverifikasi token
LMS lebih dulu. Kata sandi tidak pernah disalin dan tidak bisa dibaca (hash bcrypt).

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | 3 tampilan: login, absen, rekap admin |
| `app.js` | kamera, GPS, panggil Edge Function, tabel rekap |
| `styles.css` | tampilan + gaya cetak A4 landscape |
| `config.js` | URL/key publik (LMS untuk login, project presensi untuk data) |
| `db/chat-project.sql` | tabel presensi + bucket foto (project abbs-chat-belajar) |
| `supabase/functions/absen/index.ts` | Edge Function: verifikasi token LMS + simpan presensi |
| `tests/` | pratinjau UI dengan data palsu & uji sesi nyata |
| `BLUEPRINT.md` | latar belakang, data sekolah, keputusan desain |

## Pasang / perbarui

1. **Tabel** (sekali): jalankan `db/chat-project.sql` di SQL Editor project
   `abbs-chat-belajar` (sudah dijalankan; aman diulang).
2. **Edge Function**:
   ```
   npx supabase functions deploy absen --project-ref lthyqvxpiykqfaqrumcx --no-verify-jwt --yes
   npx supabase secrets set LMS_ANON_KEY=... LMS_URL=https://drlsnhnqxkcgcuskswwx.supabase.co \
     --project-ref lthyqvxpiykqfaqrumcx
   ```
   `LMS_ANON_KEY` = publishable key LMS (ada fallback di dalam kode, jadi jarang perlu diubah).
3. **Frontend**: ubah `config.js` bila project berubah, lalu `git push` (Pages
   memperbarui sendiri ±1 menit).
4. **Uji lokal**: `python -m http.server 8080` lalu buka <http://localhost:8080>.
   Jangan lewat `file://` — kamera & GPS butuh origin aman.

## Login

| Peran | Akun | Yang terlihat |
|---|---|---|
| Guru | username LMS (mis. `tri.wijayanti`) + kata sandi LMS | halaman absen, ringkasan periode gaji, riwayat 14 hari |
| Admin | `admin.abbs` + kata sandi LMS | rekap bulanan + pengaturan |

Username diubah dulu jadi email akun LMS lewat RPC LMS `get_email_by_username`
(atau pola `username@examfilq.dev`). Hanya guru/admin SMP ABBS yang boleh masuk.

## Aturan yang berlaku

- Absen **1× per hari**, dijaga `unique (user_id, tanggal)` di database.
- Foto wajib; kamera depan diminta otomatis saat halaman dibuka (tanpa tombol nyalakan).
  Kalau izin belum diberikan, muat ulang halaman untuk memunculkan permintaan izin lagi.
- **Perbarui lokasi** mengambil ulang GPS bila titik terasa salah (mis. baru keluar gedung).
- Jarak, jam, dan TOT dihitung **di server** (Edge Function), bukan di browser.
- **TOT** = jam absen ≤ batas TOT (default `06:50` WIB). Di atasnya = **TL** (terlambat).
- Hari kerja default **Senin–Sabtu**; hari libur dari admin jadi `L` dan tidak dihitung alpa.
- Hari kerja lewat tanpa absen = **A**; hari ini yang belum absen = kosong.
- Admin mencatat hadir manual → kode **H** (hadir tanpa TOT), supaya tidak salah jadi TL.

## Yang bisa diubah admin (tanpa deploy)

Rekap → ⚙︎ Pengaturan absensi: titik sekolah (tombol "Gunakan lokasi saya sekarang"),
**radius** (10–5000 m, default 50 m), jam batas TOT, hari kerja, dan hari libur.

## Rekap

Sel tabel berisi **jam absen** (hijau = tepat waktu, kuning = terlambat); `H` hadir
dicatat admin, `S` sakit, `I` izin, `A` alpa, `L` libur. Kolom total TOT/TL/H/S/I/A dan
%Hadir menempel di kanan. Klik sel → foto absen, jam, jarak, akurasi, dan ubah status +
catatan. Ada **Export CSV** dan **Cetak** A4 landscape.

## Ringkasan periode gaji (halaman guru)

Di akun tiap guru ada kartu **Ringkasan periode gaji**: jumlah tepat waktu (TOT),
terlambat, total masuk, sakit, izin, alpa, dan % kehadiran. Periodenya
**tanggal 21 bulan lalu sampai tanggal 20 bulan ini** (mengikuti penggajian), jadi
Desember dihitung dari 21 November sampai 20 Desember.

Di HP (mayoritas pengguna) rekap otomatis berubah jadi **kartu per guru** berisi
kalender mini: angka tanggal + jam absen, warna sesuai status, ketuk tanggal untuk
melihat foto atau mengubah status. Tabel penuh tetap dipakai di desktop dan saat mencetak.

## Batasan

- GPS bisa dipalsukan aplikasi fake-GPS; foto + jam + jarak disimpan sebagai bukti.
- Radius 50 m cukup ketat; akurasi GPS dalam gedung bisa 15–40 m. Kalibrasi lewat panel Pengaturan.
- Edge Function = satu titik tambahan: kalau project `abbs-chat-belajar` dijeda/limit,
  absensi ikut berhenti (login LMS tetap jalan).
- Foto ±200–300 MB/bulan untuk 48 guru di bucket `absensi-foto`.

## Uji

- Logika rekap: buka `index.html?uji=1` → Console harus **15/15 lulus**.
- Pratinjau UI tanpa database: `tests/mock-ui.js`, `tests/mock-absen.js`.
- Uji dengan sesi LMS asli: `tests/uji-sesi.js` (butuh `.uji-sesi.json` sementara, jangan di-commit).
