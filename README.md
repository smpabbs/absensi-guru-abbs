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

Username diubah dulu jadi email akun LMS lewat RPC LMS `get_email_by_username`
(atau pola `username@examfilq.dev`). Hanya guru/admin SMP ABBS yang boleh masuk.

## Aturan yang berlaku

- Absen **1× per hari**, dijaga `unique (user_id, tanggal)` di database.
- Foto wajib; kamera depan diminta otomatis saat halaman dibuka (tanpa tombol nyalakan).
  Kalau izin belum diberikan, muat ulang halaman untuk memunculkan permintaan izin lagi.
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

## Rekap

Sel tabel berisi **jam absen** (hijau = tepat waktu, abu = hadir, kuning = terlambat); `H` hadir
dicatat admin, `S` sakit, `I` izin, `A` alpa, `L` libur. Kolom total TOT/TL/H/S/I/A dan
%Hadir menempel di kanan. Klik sel → foto absen, jam, jarak, akurasi, dan ubah status +
catatan. Ada **Export CSV** dan **Cetak** A4 landscape.

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

## Penyimpanan (Supabase terbatas)

Yang benar-benar memakan ruang adalah **foto**, bukan data absen:

| Data | Ukuran |
|---|---|
| Baris absen (jam, status, jarak) | Â± 1.200 baris/bulan, beberapa MB/tahun |
| Foto absen | Â± 40â€“90 KB/foto setelah kompresi (sisi 760 px, kualitas â‰¤ 0,6) |
| 48 guru Ã— 25 hari Ã— 60 KB | Â± 72 MB/bulan |

Karena itu dipakai tiga lapis pengaman:

1. **Kompresi di HP** â€” foto diperkecil ke 760 px dan kualitas diturunkan sampai Â± 90 KB sebelum dikirim.
2. **Retensi otomatis** â€” foto lebih tua dari `simpan_foto_hari` (default **60 hari**) dihapus;
   baris absennya tetap ada dan ditandai "foto sudah dibersihkan". Bisa diubah admin (0 = simpan selamanya).
3. **Pembersihan terjadwal** â€” `.github/workflows/bersihkan-foto.yml` memanggil Edge Function
   setiap hari 02:30 WIB memakai header `x-cron-secret` (secret `ABSEN_CRON_SECRET` di repo,
   `CRON_SECRET` di Supabase). Admin juga bisa menjalankan manual dari panel Pengaturan.

Hitungan dengan 60 hari: 48 Ã— 25 Ã— 60 Ã— Â±60 KB â‰ˆ **430 MB** (stabil, tidak terus naik), jadi
database 500 MB tetap lega untuk tabel dan project lain.

### Kenapa tidak diarsipkan ke GitHub?

- Repo yang dipakai GitHub Pages harus **publik** â†’ wajah guru bisa diakses siapa saja.
- Git menyimpan riwayat file selamanya: menghapus foto tidak mengecilkan repo, malah tumbuh dua kali.
- Batas praktis repo Â± 1 GB dan push ribuan file biner per bulan akan lambat dan berisiko.

Kalau suatu saat butuh arsip foto permanen, jalur yang benar adalah penyimpanan terpisah
(Cloudflare R2: 10 GB gratis tanpa biaya egress, atau Google Drive sekolah), bukan GitHub Pages.
Data rekap (CSV) tetap bisa diunduh lewat tombol **Export CSV** kapan saja.
