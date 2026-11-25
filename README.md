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

## APK Android

APK dibangun otomatis oleh GitHub Actions (`.github/workflows/build-apk.yml`) memakai Capacitor,
lalu diterbitkan sebagai rilis GitHub. Ukuran ±3,9 MB, paket `id.sch.alabidin.absensiguru`,
izin: kamera, lokasi, internet (diminta saat aplikasi pertama dibuka).

- **Unduh:** <https://github.com/smpabbs/absensi-guru-abbs/releases/download/apk-latest/app-debug.apk>
- **Pasang:** buka file APK di HP → izinkan "instal dari sumber tidak dikenal" → Install.
- Isi aplikasi = file situs di folder `www/` (dibundel), jadi setiap ada perubahan web APK
  dibangun ulang otomatis, tetapi guru perlu **memasang ulang** APK untuk mendapat versi baru.
- Membangun ulang manual: Actions → "Build APK Android" → Run workflow.

## Hosting

- **Cloudflare Pages (utama):** <https://absenguruabbs.pages.dev> - deploy otomatis dari GitHub Actions
  tiap push ke `main` (.github/workflows/deploy-cloudflare.yml, secret CLOUDFLARE_API_TOKEN).
  Isi yang diunggah hanya folder `www/` (4 file situs), bukan seluruh repo. Deploy manual:
  `npm run deploy:pages`.
- **Netlify:** <https://absenguruabbs.netlify.app> - deploy otomatis dari GitHub Actions
  (.github/workflows/deploy-netlify.yml, secret NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID),
  tetapi **diblokir** karena kredit akun habis (situs masih versi lama).
- **GitHub Pages (cadangan):** <https://smpabbs.github.io/absensi-guru-abbs/>
- **VPS:** cukup arahkan document root ke folder repo (file statis), tidak perlu Node/PHP.

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
   memperbarui sendiri ±1 menit). Setiap kali mengubah `styles.css` atau `app.js`,
   naikkan nomor versi di `index.html` (`styles.css?v=3` / `app.js?v=3` → `v=4`)
   supaya browser tidak memakai file lama dari cache.
4. **Uji lokal**: `python -m http.server 8080` lalu buka <http://localhost:8080>.
   Jangan lewat `file://` — kamera & GPS butuh origin aman.

## Login

| Peran | Akun | Yang terlihat |
|---|---|---|
| Guru | username LMS (mis. `tri.wijayanti`) + kata sandi LMS | halaman absen, ringkasan periode gaji, riwayat per periode |
| Admin | `admin.abbs` + kata sandi LMS | rekap bulanan + pengaturan |

Daftar guru diambil langsung dari LMS: hanya **role guru, sekolah SMP ABBS, status aktif**
(40 orang). Guru nonaktif tidak bisa login dan tidak muncul di rekap, kecuali masih punya
catatan pada periode yang sedang dilihat (riwayat lama tetap tampil).

Username diubah dulu jadi email akun LMS lewat RPC LMS `get_email_by_username`
(atau pola `username@examfilq.dev`). Hanya guru/admin SMP ABBS yang boleh masuk.

## Aturan yang berlaku

- Absen **1× per hari**, dijaga `unique (user_id, tanggal)` di database.
- Foto wajib; **kamera baru menyala setelah lokasi masuk radius** (di luar radius panel kamera
  terkunci dan tombol Kirim Absen disembunyikan). Keluar radius >10 m membuat kamera mati otomatis.
  Izin kamera baru diminta saat pertama kali masuk radius; kalau ditolak, muat ulang halaman.
- Tombol **Perbaiki lokasi** mengambil ulang GPS bila titik terasa salah (mis. baru keluar gedung),
  tombol **Kirim Absen** mengirim foto + koordinat sekaligus.
- Jarak, jam, dan status dihitung **di server** (Edge Function), bukan di browser.
- **Tiga status masuk**: **Tepat waktu (TOT)** jika absen ≤ `06:50`; **Hadir** jika antara
  `06:51`–`07:00`; **Terlambat** jika lewat `07:00`. Jam masuk dan batas TOT bisa diubah admin.
- Hari kerja default **Senin–Sabtu**; hari libur dari admin jadi `L` dan tidak dihitung alpa.
- Hari kerja lewat tanpa absen = **A**; hari ini yang belum absen = kosong.
- Admin mencatat hadir manual → kode **H** (hadir tanpa TOT), supaya tidak salah jadi terlambat.

## Yang bisa diubah admin (tanpa deploy)

Rekap → tombol **Pengaturan**: titik sekolah (tombol "Gunakan lokasi saya"),
**radius** (10–5000 m, default 50 m), **jam masuk**, **batas TOT**, hari kerja, dan hari libur.

## Pengecualian TOT (kebijakan manajemen unit)

Admin bisa menetapkan daftar username yang kehadirannya **selalu dihitung TOT**, sesuai
kebijakan resmi unit (mis. guru yang memegang tugas manajemen). Diatur di
**Pengaturan → Pengecualian TOT (kebijakan)**.

Perilakunya:

- Absen masuk jam berapa pun (termasuk setelah 07.00) → dicatat **tepat waktu (TOT)**;
  jam sebenarnya tetap tersimpan.
- Hari kerja yang terlewat tanpa absen → otomatis dicatat **hadir (kebijakan)** dengan catatan
  "Kebijakan manajemen unit (tidak absen)". Pengisian berjalan tiap malam lewat workflow
  `arsip-harian.yml` (aksi `isi_kebijakan`), dan bisa dipicu manual.
- Di rekap sel tampil **`TOT*`** (hijau) untuk hari yang diisi kebijakan; legenda menjelaskan artinya.
  Data tetap dapat diaudit: baris kebijakan punya penanda `kebijakan = true` + catatan.

## Rekap

Rekap admin memakai **periode gaji 21 s.d. 20** (bukan bulan kalender): pilih periode di dropdown,
kepala kolom menampilkan tanggal + bulan (mis. `21 Okt`, `1 Nov`). Sel tabel berisi **jam absen**
(hijau = tepat waktu, abu = hadir, kuning = terlambat); `H` hadir
dicatat admin, `S` sakit, `I` izin, `A` alpa, `L` libur. Kolom total TOT/TL/H/S/I/A dan
%Hadir menempel di kanan. Klik sel → foto absen, jam, jarak, akurasi, dan ubah status +
catatan. Ada **Export Excel** (.xlsx berformat: header berwarna, garis tabel, pembekuan kolom nama, siap dicetak landscape) dan **Cetak** A4 landscape.

## Riwayat per periode (halaman guru)

Riwayat menampilkan **semua tanggal dalam periode gaji** (21 bulan lalu - 20 bulan ini), bukan
hanya yang ada absennya. Tiap baris: tanggal, status (Tepat waktu / Hadir / Terlambat / Izin /
Sakit / Alpa / Libur / **Belum absen**), jam, dan jarak. Di atas daftar ada ringkasan: masuk,
tepat waktu, terlambat, izin, sakit, alpa, belum absen, dan % kehadiran periode itu.
Tombol panah memindahkan periode (bulan sebelumnya/berikutnya).

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

## Penyimpanan & arsip (Supabase → Google Drive)

Supabase dipakai sebagai pintu masuk harian, Google Drive sebagai arsip permanen.

| Data | Tempat | Keterangan |
|---|---|---|
| Baris absen (jam, status, jarak) | Supabase, permanen | ± 1.200 baris/bulan, beberapa MB/tahun |
| Foto < periode berjalan | Supabase Storage | ± 60 KB/foto setelah kompresi (sisi 760 px, q ≤ 0,6) |
| Foto periode yang sudah selesai | **Google Drive** | folder `project/absensi guru/<21 ... sd ... 20>` |

Alur otomatis:

1. **Tiap malam 23:30 WIB** — `.github/workflows/arsip-harian.yml` menyalin foto yang belum
   terarsip ke Drive (tidak menghapus apa pun).
2. **Tanggal 21 pukul 00:30 WIB** — `.github/workflows/arsip-final.yml` memastikan semua foto
   periode 21→20 yang baru selesai sudah tersalin, lalu menghapus fotonya dari Supabase Storage.
   Baris absen tetap ada dan ditandai "foto sudah diarsipkan".
3. Foto arsip tetap bisa dibuka dari web: sel di rekap → fungsi server mengambil file dari
   Drive (bukan link publik), tetap wajib login.

Admin juga bisa memicu langkah 2 dari **Pengaturan → Arsip Google Drive → "Arsipkan periode
lalu sekarang"**. Keduanya memakai header `x-cron-secret` (secret repo `ABSEN_CRON_SECRET`
sama dengan `CRON_SECRET` di Supabase).

### Kenapa tidak di GitHub?

- Repo GitHub Pages harus publik → wajah guru bisa diakses siapa saja.
- Git menyimpan riwayat file selamanya; menghapus foto tidak mengecilkan repo.
- Batas praktis repo ± 1 GB; ribuan file biner per bulan akan lambat dan berisiko.

Snapshot rekap (CSV) tetap bisa diunduh lewat tombol **Export CSV** kapan saja.
Kredensial Google (OAuth client + refresh token) hanya disimpan sebagai secret Supabase/GitHub,
tidak pernah masuk repo maupun `config.js`.
