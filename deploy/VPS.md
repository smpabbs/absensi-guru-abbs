# Pasang aplikasi absensi di VPS (panduan untuk pemula)

Tujuan: semua akses guru/admin lewat VPS Bapak, dengan **HTTPS** (wajib, karena kamera & GPS
hanya jalan di HTTPS). Aplikasi ini **situs statis** — VPS hanya menyajikan file; database,
login, dan arsip Drive tetap di layanan yang sudah ada.

```
HP guru ──► https://absen.domain-sekolah.sch.id  (Nginx di VPS)
                │  menyajikan index.html, app.js, styles.css, config.js
                ├──► Supabase LMS        (login akun guru)
                └──► Supabase presensi   (Edge Function: simpan absen)
                              └──► Google Drive (arsip foto bulanan)
```

## 0. Yang perlu disiapkan

| Hal | Saran |
|---|---|
| VPS | 1 vCPU, RAM 1 GB, disk 20 GB, Ubuntu 24.04 LTS — cukup untuk puluhan guru |
| Domain | subdomain, mis. `absen.smpabbs.alabidin.sch.id` (minta ke pengelola domain sekolah) |
| Akses | IP VPS + password root (dari email penyedia VPS) |
| Repo | `https://github.com/smpabbs/absensi-guru-abbs` |

> Jangan pakai IP saja. Tanpa domain + HTTPS, browser HP akan menolak akses kamera/lokasi.

## 1. Masuk ke VPS

Dari PowerShell Windows:

```powershell
ssh root@IP_VPS
```

Ketik `yes` saat ditanya fingerprint, lalu masukkan password root (tidak terlihat saat diketik).

## 2. Amankan dasar (10 menit)

```bash
# perbarui sistem
apt update && apt upgrade -y

# buat user biasa (jangan kerja sebagai root)
adduser absen
usermod -aG sudo absen
rsync --archive --chown=absen:absen ~/.ssh /home/absen

# firewall: hanya SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable
ufw status
```

Keluar lalu masuk lagi sebagai user baru:

```bash
exit
ssh absen@IP_VPS
```

## 3. Pasang Nginx & siapkan folder

```bash
sudo apt install -y nginx git
sudo systemctl enable --now nginx

sudo mkdir -p /var/www/absensi
sudo chown -R absen:absen /var/www/absensi
```

Uji: buka `http://IP_VPS` di browser — harus muncul halaman "Welcome to nginx".

## 4. Ambil kode aplikasi

**Kalau repo masih publik (paling mudah):**

```bash
git clone https://github.com/smpabbs/absensi-guru-abbs.git /var/www/absensi
```

**Kalau repo sudah privat** — buat kunci khusus di VPS, lalu daftarkan ke GitHub:

```bash
ssh-keygen -t ed25519 -C "vps-absensi" -f ~/.ssh/github_absensi -N ""
cat ~/.ssh/github_absensi.pub
```

Salin hasilnya ke: repo GitHub → **Settings → Deploy keys → Add deploy key** (centang tidak perlu
write access). Lalu:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_absensi -o IdentitiesOnly=yes" \
  git clone git@github.com:smpabbs/absensi-guru-abbs.git /var/www/absensi
```

## 5. Konfigurasi Nginx

```bash
sudo cp /var/www/absensi/deploy/nginx-absensi.conf /etc/nginx/sites-available/absensi
```

Edit nama domainnya:

```bash
sudo nano /etc/nginx/sites-available/absensi
# ganti: server_name absen.smpabbs.alabidin.sch.id;
# simpan: Ctrl+O, Enter, lalu Ctrl+X
```

Aktifkan dan uji:

```bash
sudo ln -s /etc/nginx/sites-available/absensi /etc/nginx/sites-enabled/absensi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Arahkan domain ke VPS

Di panel domain sekolah, tambahkan:

| Tipe | Nama | Nilai |
|---|---|---|
| A | `absen` | `IP_VPS` |

Tunggu 5–30 menit. Uji:

```bash
ping absen.smpabbs.alabidin.sch.id
```

Kalau sudah menunjuk IP VPS, `http://absen.smpabbs.alabidin.sch.id` harus membuka halaman login.

## 7. Pasang HTTPS (wajib)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d absen.smpabbs.alabidin.sch.id
```

Jawab: masukkan email, setuju TOS, pilih **redirect HTTP → HTTPS**.
Perpanjangan otomatis sudah diatur; uji dengan:

```bash
sudo certbot renew --dry-run
```

## 8. Uji menyeluruh

1. Buka `https://absen.smpabbs.alabidin.sch.id` — ada ikon gembok.
2. Login dengan akun LMS.
3. Izinkan kamera & lokasi (harus muncul popup).
4. Lakukan satu absen percobaan (dalam radius).
5. Login admin → rekap tampil → Export Excel berhasil.
6. Cek `https://.../config.js` hanya berisi kunci publik (`sb_publishable_...`).

## 9. Cara memperbarui aplikasi

Manual (cukup untuk awal):

```bash
cd /var/www/absensi
git pull
```

Otomatis (opsional, nanti): GitHub Actions menyalin file ke VPS setiap push. Bisa saya buatkan
kalau Bapak sudah punya IP + kunci SSH.

## 10. Perawatan rutin

```bash
# pembaruan keamanan otomatis
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# cek status
systemctl status nginx
sudo nginx -t
```

Backup cukup: simpan `/etc/nginx/sites-available/absensi` dan isi `/var/www/absensi`
(sisanya ada di GitHub dan Supabase).

## 11. Kalau ada masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| 502/504 | Nginx mati | `sudo systemctl restart nginx` |
| 403 Forbidden | izin folder | `sudo chown -R www-data:www-data /var/www/absensi` |
| Kamera tidak muncul | bukan HTTPS | pastikan certbot selesai, buka `https://` |
| Halaman kosong | aset 404 | cek `ls /var/www/absensi` berisi `index.html`, `app.js`, `styles.css`, `config.js` |
| Domain belum jalan | DNS | tunggu propagasi, cek A record |

## 12. Rollback

Selama masa uji, **Netlify tetap hidup** (`https://absenguruabbs.netlify.app`). Kalau VPS
bermasalah, cukup arahkan guru kembali ke link Netlify — tidak ada data yang hilang karena
data ada di Supabase/Drive, bukan di VPS.

## 13. Yang tidak boleh dilakukan di VPS

- Jangan menaruh `service_role` key, kunci Google, atau token GitHub di folder situs —
  semua itu sudah disimpan sebagai secret di Supabase/GitHub.
- Jangan mengubah `config.js` selain URL/key publik.
- Jangan mematikan firewall setelah semuanya jalan.
