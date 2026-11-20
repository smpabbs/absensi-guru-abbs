# Absensi Guru SMP ABBS Surakarta

Aplikasi absensi guru: login pakai akun LMS, absen foto + GPS dalam radius sekolah,
rekap bulanan untuk admin dengan aturan **TOT** (tepat waktu ≤ batas jam).

Tanpa build step — HTML + CSS + JS biasa, database Supabase project LMS, host statis (Vercel/GitHub Pages).

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | 3 tampilan: login, absen, rekap admin |
| `app.js` | kamera, GPS, panggil fungsi database, tabel rekap |
| `styles.css` | tampilan + gaya cetak A4 landscape |
| `config.js` | URL Supabase + publishable key (aman untuk browser) |
| `db/20261120_absensi_guru.sql` | tabel, RLS, fungsi validasi, bucket foto |
| `BLUEPRINT.md` | latar belakang, data sekolah, keputusan desain |

## Pasang (sekali)

1. **Jalankan SQL.** Buka Supabase → project LMS (`drlsnhnqxkcgcuskswwx`) → SQL Editor →
   tempel seluruh isi `db/20261120_absensi_guru.sql` → Run.
   Cek hasilnya:
   ```sql
   select * from absensi_pengaturan;          -- harus ada 1 baris, radius 50
   select absensi_login_email('admin.abbs');  -- harus mengembalikan email admin
   ```
2. **Isi `config.js`** kalau project Supabase berbeda (sekarang sudah terisi).
3. **Buka aplikasi.** Untuk uji lokal:
   ```powershell
   cd X:\absensi-guru-abbs
   python -m http.server 8080
   ```
   Lalu buka <http://localhost:8080>. Jangan buka lewat `file://` — kamera & GPS butuh origin aman.
4. **Deploy**: folder ini statis, bisa langsung `vercel --prod` atau upload ke hosting sekolah.
   Domain yang disarankan: `absen.smpabbs.alabidin.sch.id`.

## Login

| Peran | Akun | Yang terlihat |
|---|---|---|
| Guru | username LMS (mis. `tri.wijayanti`) + kata sandi LMS | halaman absen + riwayat 14 hari |
| Admin | `admin.abbs` (admin LMS SMP ABBS) | rekap bulanan + pengaturan |

Tidak ada akun atau kata sandi baru. Guru yang belum punya username di LMS tidak bisa login —
urus di LMS dulu.

## Aturan yang berlaku

- Absen **1× per hari**, dijaga `unique (user_id, tanggal)` di database.
- Foto wajib; diambil dari kamera depan, dikirim bersama koordinat.
- Jarak dihitung **di server** (haversine). Di luar radius → ditolak, aplikasi menampilkan jarak sebenarnya.
- Jam memakai zona **Asia/Jakarta**, bukan jam perangkat. Guru tidak bisa memalsukan jam dengan mengubah jam HP.
- **TOT** = jam absen ≤ batas TOT (default `06:50`). Di atas batas = **TL** (terlambat), tetap tercatat hadir.
- Admin yang mencatat hadir manual menghasilkan kode **H** (hadir tanpa TOT) — dipakai kalau guru lupa absen.
- Hari kerja default **Senin–Sabtu**. Hari libur yang diisi admin otomatis jadi `L` dan tidak dihitung alpa.
- Hari kerja lewat tanpa absen = **A** (alpa). Hari ini yang belum absen = kosong, bukan alpa.
- Akun admin hanya untuk rekap; absen hanya untuk akun ber-role `guru`.

## Yang bisa diubah admin (tanpa deploy)

Buka **Rekap → ⚙︎ Pengaturan absensi**:

- titik sekolah (lintang/bujur) — tombol "Gunakan lokasi saya sekarang" untuk kalibrasi saat berdiri di gerbang sekolah;
- **radius** (10–5000 m, default 50 m);
- jam batas TOT;
- hari kerja (centang);
- hari libur per tanggal.

Semua tersimpan di tabel `absensi_pengaturan` / `absensi_libur`, tidak perlu ubah kode.

## Rekap

- Grid guru (baris) × tanggal (kolom), kode `TOT / TL / H / S / I / A / L`.
- Kolom total: TOT, TL, S, I, A, %Hadir.
- Klik sel → foto absen (signed URL 10 menit), jam, jarak, akurasi, dan ubah status manual
  (+catatan, mis. "surat dokter").
- **Export CSV** (UTF-8 BOM, langsung rapi di Excel) dan **Cetak** (A4 landscape).

## Batasan yang diketahui

- GPS bisa dipalsukan aplikasi fake-GPS. Untuk v1 diterima; foto wajah + jam + jarak tersimpan sebagai bukti.
- Radius 50 m cukup ketat; di dalam gedung akurasi GPS bisa 15–40 m. Kalibrasi dulu (lihat pengaturan) dan pantau keluhan hari pertama.
- Foto disimpan di bucket privat `absensi-foto`, hanya bisa dibaca pemiliknya dan admin. ±200–300 MB/bulan untuk 48 guru.
- Bila akun LMS guru dihapus, baris absensinya ikut terhapus (`on delete cascade`).

## Uji

- Logika rekap (kode sel, total, hari efektif, libur, hari kerja, hadir manual):
  buka `index.html?uji=1` → hasil di Console (harus **15/15 lulus**).
- Pratinjau tampilan tanpa database: `tests/mock-ui.js` (rekap admin) dan `tests/mock-absen.js`
  (halaman guru) dijalankan lewat Playwright MCP / Playwright biasa dengan `page.route`.
