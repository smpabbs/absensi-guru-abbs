# Blueprint — Absensi Guru SMP ABBS Surakarta

Status: **draft v1** · 20 Nov 2026 · rancangan sudah diimplementasikan (lihat `README.md`)

> Implementasi memakai HTML+CSS+JS statis + fungsi server, tanpa build step.
> **Revisi 20 Nov:** data presensi dipindah ke project terpisah `abbs-chat-belajar`
> (tabel `absen_presensi`, `absen_pengaturan`, `absen_libur`, bucket `absensi-foto`)
> lewat Edge Function `absen`, karena login tetap harus memakai akun LMS.
> Rincian alur ada di `README.md`; sisa pekerjaan: uji lapangan (kalibrasi titik & radius).

---

## 1. Ringkasan keputusan

| Hal | Keputusan |
|---|---|
| Login | Akun LMS yang sudah ada (username + password). Tidak ada tabel user/password baru. |
| Identitas guru | Langsung dari `profiles` LMS (SMP ABBS Surakarta = 48 guru, semua sudah punya username). Tidak perlu import `Gurus.xlsx` lagi. |
| Admin rekap | Akun ber-role `admin` milik SMP ABBS (sekarang `admin.abbs`). Username `adimsmpabbs` **belum ada** di LMS — lihat §9. |
| Absen | 1× per hari, wajib foto (kamera depan) + GPS, servo validasi radius 50 m di server. |
| TOT | `tepat_waktu = jam_masuk ≤ 06:50` (WIB). Dihitung di server, bukan di browser. |
| Rekap | Grid bulanan guru × tanggal, kolom total TOT / Terlambat / S / I / A, bisa dicetak + CSV. |
| Stack | Next.js 16 App Router + Supabase (project LMS yang sama) + Vercel. Sama seperti LMS, supaya tidak ada stack baru. |
| Data absensi | Tabel baru `absensi_guru` + bucket Storage privat `absensi-foto`. Tidak menyentuh tabel LMS yang ada. |

---

## 2. Hasil audit repo lama (jangan diulang)

| Lokasi | Isi | Status |
|---|---|---|
| `C:\Users\kurikulum\absen_piket_guru` | 1 file `index.html` (piket guru, tanpa backend) | Arsip, tidak dipakai |
| `X:\absenguru` | Flask: login dari `Gurus.xlsx`, foto base64, haversine 50 m | **Yang paling dekat**, tapi rusak di beberapa titik |
| `X:\smpabbs-ngajaryuk` | Laravel: `AbsensiController` + tabel `absensis` (lat/lon, foto, cek absen ganda) | Konsepnya dipakai, kodenya tidak |
| `X:\presensi digial emodul 2627` | HTML + Apps Script, tanpa radius | Arsip |

Kelemahan `X:\absenguru` yang wajib diperbaiki:

1. **Password guru tersimpan plaintext** di `Gurus.xlsx` (`triwijayanti@... / 12737`). Itu sebabnya login harus pindah ke LMS.
2. Data absensi = file JSON + foto di disk lokal server. Hilang kalau pindah mesin, tidak bisa diakses dari HP lain, tidak ada backup.
3. Tidak ada rekap admin sama sekali — tidak ada halaman admin, tidak ada aturan TOT, tidak ada rekap bulanan.
4. Radius 50 m masih default `-7.5529, 110.7993` (titik lama, bukan titik sekolah).
5. HTTPS pakai `cert.pem` self-signed → kamera/GPS sering diblokir browser di HP.
6. `Gurus.xlsx` isinya 41 baris, sementara LMS punya 48 guru SMP ABBS → datanya sudah kedaluwarsa.

---

## 3. Data yang sudah dikumpulkan

### 3.1 LMS (sumber login & master guru)

- Repo: `X:\LMSReal\lms-new` — Next.js 16, Supabase, Vercel.
- Produksi: `https://lms-abbjhs.vercel.app` (lihat `modul.md`).
- Supabase project ref: `drlsnhnqxkcgcuskswwx` (sama dengan dashboard monitor-lms).
- Tabel `profiles`: `id` (= `auth.users.id`), `email`, `nama`, `username`, `role` (`guru|siswa|admin|admin_keuangan`), `sekolah_id`, `status`.
- Login LMS: username → RPC `get_email_by_username(p_username)` → `signInWithPassword`. **RPC itu hanya meloloskan `role='guru'`**, jadi admin tidak bisa lewat jalur itu → kita butuh resolver sendiri.
- Helper RLS yang bisa dipakai ulang: `public.is_admin()`.

### 3.2 Angka nyata dari database (dibaca 20 Nov 2026)

```
total profiles        2.523
guru                  213   (48 di antaranya SMP ABBS Surakarta)
admin                  12   (1 untuk SMP ABBS Surakarta)
guru tanpa username     1   (di seluruh sekolah)
```

- `sekolah_id` **SMP ABBS Surakarta** = `503a0f26-abeb-4a0f-94a4-2f4a23fc96d2`
- Admin SMP ABBS Surakarta: username `admin.abbs`, nama "Admin SMP ABBS Surakarta", status aktif.
- Username guru SMP ABBS berpola `nama.belakang` (`tri.wijayanti`, `agus`, `guru01`, dst.) → guru cukup mengetik username yang biasa dipakai di LMS.
- Belum ada tabel/bucket absensi apa pun di project (aman, tidak bentrok). Bucket yang sudah ada: `soal-images`, `module-assets`, `ttd-rapor`, dll.

### 3.3 Titik sekolah

| Sumber | Koordinat |
|---|---|
| Google Places "ABBS JUNIOR HIGH SCHOOL SURAKARTA" (+ embed di website sekolah) | `-7.539134, 110.805751` |
| Dapodik NPSN 70040216 | `-7.539129, 110.803176` |

Beda 2 sumber ± 285 m di bujur, jadi **titik harus dikalibrasi sekali di lokasi** (admin berdiri di gerbang/lapangan, tekan "set titik"). Untuk v1 pakai default Google `-7.539134, 110.805751` dan radius 50 m.

Alamat resmi: Jl. Tarumanegara III RT 001 RW 007, Banyuanyar, Banjarsari, Surakarta 57137. NPSN 70040216.

---

## 4. Arsitektur

```
HP guru (browser)                     Vercel (Next.js)                Supabase (project LMS)
┌──────────────────┐   login    ┌────────────────────────┐   RPC     ┌──────────────────┐
│ /login           │───────────▶│ absensi_login_email()  │──────────▶│ profiles/auth    │
│ username+sandi   │◀───────────│ signInWithPassword     │◀──────────│                  │
└──────────────────┘            │                        │           │                  │
┌──────────────────┐  foto+GPS  │ server action absen(): │  upload   │ Storage          │
│ /absen           │───────────▶│ - ambil jam WIB        │──────────▶│ absensi-foto     │
│ kamera+geoloc    │◀───────────│ - haversine ≤ 50 m     │  insert   │                  │
└──────────────────┘            │ - tot = jam ≤ 06:50    │──────────▶│ absensi_guru     │
┌──────────────────┐            │ rekap(admin only)      │  select   │                  │
│ /admin/rekap     │───────────▶│                        │──────────▶│                  │
└──────────────────┘            └────────────────────────┘           └──────────────────┘
```

Prinsip: **browser tidak dipercaya** untuk tiga hal — jarak, jam, status TOT. Semua dihitung ulang di server. Foto dikirim sebagai base64 sekali lewat server action (maks 8 MB), server yang menyimpan ke Storage.

Repo baru: `absensi-guru-abbs` (terpisah dari LMS supaya produksi LMS tidak ikut berisiko). Deploy Vercel, env sama dengan LMS.

---

## 5. Skema database

File: `db/20261120_absensi_guru.sql` (sudah dibuat di folder ini).

```sql
create table public.absensi_guru (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  sekolah_id   uuid not null references public.sekolah(id),
  tanggal      date not null,               -- tanggal WIB
  jam          time not null,               -- jam WIB saat tombol absen ditekan
  status       text not null default 'hadir'
               check (status in ('hadir','izin','sakit','alpa')),
  tepat_waktu  boolean not null default false,
  lat          double precision,
  lon          double precision,
  akurasi_m    double precision,
  jarak_m      double precision,
  foto_path    text,
  catatan      text,
  dicatat_oleh uuid references public.profiles(id),  -- null = absen sendiri
  created_at   timestamptz not null default now(),
  unique (user_id, tanggal)                  -- 1 absen per hari, dijaga DB
);

create table public.absensi_libur (
  tanggal    date primary key,
  keterangan text
);
```

Catatan desain:

- `unique (user_id, tanggal)` adalah pengaman absen ganda; server tidak perlu cek-lalu-insert (race condition di percobaan lama).
- `tepat_waktu` disimpan, **tidak** dihitung ulang saat baca → rekap 3 bulan lalu tetap konsisten walau jam batas diubah nanti.
- `jarak_m` + `akurasi_m` disimpan sebagai bukti (kalau suatu saat ada sengketa "saya sudah di sekolah").
- `dicatat_oleh` menandai entri manual admin (izin/sakit) supaya tidak tertukar dengan absen mandiri.
- Tidak ada tabel user, tidak ada tabel password, tidak ada tabel kelas — semua dari LMS.

RLS: guru hanya bisa `select` barisnya sendiri; admin sekolah bisa `select` semua baris sekolahnya. `insert/update` hanya lewat service role (server action), jadi tidak ada policy tulis untuk klien.

---

## 6. Aturan bisnis (yang harus persis begini)

### 6.1 Absen mandiri

1. Login username + password LMS. Profil harus `role='guru'` **atau** `'admin'`, `status='aktif'`.
2. Hari Sabtu/Minggu → form absen menolak dengan pesan "bukan hari kerja".
3. Tekan "Ambil Foto" → kamera depan (`getUserMedia`, fallback `<input capture>`), preview, lalu "Absen".
4. Browser kirim `{lat, lon, akurasi, foto}`. Isi `jam` **tidak** dikirim.
5. Server:
   - `jam` = sekarang WIB (`Intl` / `toLocaleString` dengan `Asia/Jakarta`, bukan `new Date()` mentah — Vercel jalan di UTC).
   - `jarak_m` = haversine(lat, lon, titik sekolah).
   - `jarak_m > 50` → tolak, sertakan angka jarak sebenarnya.
   - `tepat_waktu = jam <= 06:50`.
   - simpan foto ke `absensi-foto/{tahun}/{bulan}/{user_id}-{tanggal}.jpg`.
   - `insert`; kalau kena unique constraint → "Anda sudah absen hari ini jam HH:MM".
6. Hasil: kartu sukses menampilkan status **TOT** atau **TERLAMBAT**, jam, jarak (mis. "42 m dari titik sekolah"), dan foto.

### 6.2 Kode rekap

| Kode | Arti | Sumber |
|---|---|---|
| `TOT` | Tepat waktu (≤ 06:50) | absen mandiri |
| `TL` | Terlambat (> 06:50) | absen mandiri |
| `S` | Sakit | input admin |
| `I` | Izin | input admin |
| `A` | Alpa | turunan: hari kerja yang sudah lewat tanpa baris |
| `L` | Libur | `absensi_libur` / Sabtu–Minggu |

### 6.3 Rekap bulanan (admin)

Kolom: No · Nama · 1..31 · **TOT · TL · S · I · A · %Hadir**

- `%Hadir = (TOT + TL) / hari kerja efektif × 100`, di mana hari kerja efektif = hari Senin–Jumat yang sudah lewat di bulan itu, dikurangi `absensi_libur`.
- Sel hari ini yang belum absen = `–` (bukan A). Hari ke depan = kosong abu-abu.
- Klik sel → modal: lihat foto + jam + jarak + akurasi, atau ubah status (izin/sakit/alpa + catatan).
- Tombol: ganti bulan, cari nama, **Export CSV**, **Cetak** (CSS print A4 landscape, kolom tanggal diringkas 2 digit).
- Baris ringkasan di atas tabel: total guru, sudah absen hari ini, jumlah TOT hari ini, jumlah terlambat.

---

## 7. Halaman & wireframe

### 7.1 `/login`

```
┌──────────────────────────────────┐
│            [logo ABBS]           │
│      Absensi Guru SMP ABBS       │
│  ┌────────────────────────────┐  │
│  │ Username (akun LMS)        │  │
│  ├────────────────────────────┤  │
│  │ Kata sandi            [👁] │  │
│  └────────────────────────────┘  │
│        [ Masuk ]                 │
│  Lupa sandi? → LMS              │
└──────────────────────────────────┘
```

### 7.2 `/absen` (guru)

```
Halo, Tri Wijayanti            [Keluar]
Kamis, 20 November 2026 · 06:41 WIB

┌───────────────┐   Jarak ke titik sekolah
│   [ kamera ]  │   37 m  ✔ dalam radius 50 m
│    preview    │   akurasi ±12 m
└───────────────┘
   [ Absen Sekarang ]

Riwayat bulan ini:
 20/11 06:41  TOT   37 m
 19/11 06:58  TL   112 m   <- contoh
```

Kalau sudah absen hari ini: kamera diganti kartu hijau "Sudah absen 06:41 · TOT".

### 7.3 `/admin/rekap` (admin)

```
Rekap Absensi Guru — [November 2026 ▾]   [Export CSV] [Cetak]
48 guru · sudah absen hari ini 41 · TOT 33 · terlambat 8

┌────┬────────────────┬─1─2─3─…─30┬ TOT TL  S  I  A  % ┐
│ 1  │ Tri Wijayanti  │ TOT TOT L … │  18  2  0  0  0 90%│
│ 2  │ Agus           │ TOT TL  L … │  15  3  1  1  0 82%│
└────┴────────────────┴────────────┴────────────────────┘
klik sel → foto + jam + jarak, atau set Izin/Sakit/Alpa
```

---

## 8. Struktur repo

```
absensi-guru-abbs/
├─ app/
│  ├─ login/page.tsx + actions.ts
│  ├─ absen/page.tsx + actions.ts        # server action: validasi + simpan
│  ├─ admin/rekap/page.tsx + actions.ts  # rekap bulanan + set status manual
│  └─ layout.tsx
├─ lib/
│  ├─ absen-config.ts     # TITIK_LAT, TITIK_LON, RADIUS_M=50, BATAS_TOT='06:50', TZ
│  ├─ geo.ts              # haversine (10 baris)
│  ├─ waktu.ts            # nowWIB(), tanggalWIB(), jamWIB()
│  └─ supabase/server.ts  # 3 client: browser, server (cookie), service-role
├─ db/20261120_absensi_guru.sql
└─ .env.local             # NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
```

Tidak pakai React Query, tidak pakai UI kit baru, tidak pakai ORM. Server action + `supabase-js` cukup untuk 3 halaman.

---

## 9. Keputusan yang sudah diambil (20 Nov 2026)

1. **Admin rekap** memakai akun admin LMS yang sudah ada: `admin.abbs` ("Admin SMP ABBS Surakarta", role `admin`).
   Tidak ada akun baru. Akun admin **tidak** dipakai untuk absen — hanya rekap.
2. **Hari kerja**: Senin–Sabtu (default di `absensi_pengaturan.hari_kerja = {1,2,3,4,5,6}`).
3. **Radius**: ketat **50 m**, tetapi admin bisa mengubahnya sendiri (10–5000 m) beserta titik sekolah dan jam batas TOT dari halaman Rekap.
4. **Absen pulang**: belum ada di v1.
5. **Izin/sakit**: diinput admin per sel (kode `I`/`S`), plus kode `H` bila admin mencatat hadir manual.

Catatan implementasi: aplikasi jadi HTML+CSS+JS statis yang memanggil fungsi database
(`absensi_login_email`, `absensi_absen`, `absensi_set_status`), bukan Next.js — validasi
tetap di server (Postgres), tanpa proses build dan tanpa server tambahan.

---

## 10. Rencana kerja

| # | Milestone | Isi | Perkiraan |
|---|---|---|---|
| 1 | Fondasi | repo Next.js + Tailwind, 3 client Supabase, migration + bucket, RPC `absensi_login_email` | ½ hari |
| 2 | Login + absen | halaman login, kamera, geolokasi, server action (radius + TOT + unique), halaman sukses | 1 hari |
| 3 | Rekap admin | grid bulanan, total, modal detail foto, set izin/sakit, CSV + print | 1 hari |
| 4 | Uji lapangan | 3–5 guru absen asli di lokasi, ukur akurasi GPS, kalibrasi titik & radius | ½ hari |
| 5 | Rilis | deploy Vercel + domain `absen.smpabbs.alabidin.sch.id`, link dari LMS | ½ hari |

Total ± 3,5 hari kerja.

---

## 11. Risiko yang harus diketahui sekarang

| Risiko | Dampak | Sikap |
|---|---|---|
| GPS bisa dipalsukan (fake GPS app) | guru di rumah bisa "absen" | Diterima untuk v1. Mitigasi nanti: cek Wi-Fi sekolah / device binding. Foto wajah + jam tetap jadi bukti sosial. |
| 50 m terlalu ketat di dalam gedung | guru gagal absen, komplain | Uji lapangan (milestone 4) sebelum rilis, radius = konstanta. |
| Zona waktu | Vercel UTC → TOT salah 7 jam kalau `new Date()` dipakai mentah | Semua waktu lewat `lib/waktu.ts` dengan `Asia/Jakarta`. Wajib. |
| Foto 48 guru/hari | Storage naik ±200–300 MB/bulan | Bucket privat, kompresi client ke JPEG 0,7 maks 1280 px. Cukup untuk bertahun-tahun di plan sekarang. |
| Akun LMS guru dihapus / pindah sekolah | baris absensi ikut terhapus (`on delete cascade`) | Untuk v1 diterima (data ikut orangnya). Kalau rekap harus permanen, ubah jadi `on delete restrict` + snapshot nama. |
| Titik sekolah beda 285 m antar sumber | absen valid di titik salah | Kalibrasi manual sekali, disimpan sebagai konstanta hasil ukur. |

---

## 12. Referensi file

- Repo lama (arsip): `X:\absenguru`
- LMS: `X:\LMSReal\lms-new` (login: `lib/hooks/useLogin.ts`, RPC: `supabase/schema_prod.sql`)
- Konsep absensi lama: `X:\smpabbs-ngajaryuk\app\Http\Controllers\AbsensiController.php`
- Website sekolah (alamat + embed peta): `X:\websie smp abbs\website-sekolah`
- Migration draft: `db/20261120_absensi_guru.sql`
