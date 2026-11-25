// Absensi Guru SMP ABBS Surakarta — tanpa build step.
// Validasi jarak, jam, dan TOT dilakukan di database (fungsi absensi_absen),
// jadi nilai di sini hanya untuk tampilan.

const TZ = 'Asia/Jakarta';
const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const db = supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true }
});

let profil = null;
let pengaturan = null;
let posisi = null;
let stream = null;
let dalamRadius = false;
let memintaKamera = false;
let izinKameraGagal = false;
let pengamatLokasi = null;
let sudahAbsen = false;
let absenHariIni = null;
let modeDemo = new URLSearchParams(location.search).get('demo') === '1';
let riwayatPeriode = null;
let periodeSekarang = null;

const rekap = {
  bulan: '',
  guru: [],
  peta: new Map(),
  libur: new Set(),
  liburDaftar: [],
  hariKerja: new Set([1, 2, 3, 4, 5, 6]),
  hariIni: ''
};

// ── util ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function toast(teks) {
  const t = $('toast');
  t.textContent = teks;
  t.classList.add('tampil');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('tampil'), 3200);
}

const tanggalWIB = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const jamWIB = (d = new Date()) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

const tanggalPanjang = (str) =>
  new Date(str + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const bulanPanjang = (bulan) =>
  new Date(bulan + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

const bulanIniWIB = () => tanggalWIB().slice(0, 7);
const isoDow = (str) => ((new Date(str + 'T00:00:00').getDay() + 6) % 7) + 1;
const potongJam = (jam) => (jam || '').slice(0, 5);

// geser tanggal 'YYYY-MM-21' sebanyak delta bulan (untuk melihat periode lalu)
function geserBulan(tgl, delta) {
  const [y, m] = tgl.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-21`;
}

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Periode gaji berjalan: 21 bulan lalu s.d. 20 bulan ini (jika tgl >= 21, periode dimulai bulan ini).
function periodeMulaiSekarang() {
  const [y, m, d] = tanggalWIB().split('-').map(Number);
  let ay = y, am = m;
  if (d < 21) {
    const dt = new Date(Date.UTC(y, m - 2, 1));
    ay = dt.getUTCFullYear();
    am = dt.getUTCMonth() + 1;
  }
  return `${ay}-${String(am).padStart(2, '0')}-21`;
}

function periodeDariMulaiJs(mulai) {
  const [y, m] = mulai.split('-').map(Number);
  const akhir = new Date(Date.UTC(y, m, 1));
  const selesai = `${akhir.getUTCFullYear()}-${String(akhir.getUTCMonth() + 1).padStart(2, '0')}-20`;
  const label = `21 ${BULAN_PENDEK[m - 1]} ${y} – 20 ${BULAN_PENDEK[akhir.getUTCMonth()]} ${akhir.getUTCFullYear()}`;
  return { mulai, selesai, label };
}

function tanggalAntara(mulai, selesai) {
  const hasil = [];
  for (let d = new Date(mulai + 'T00:00:00Z'); d <= new Date(selesai + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    hasil.push(d.toISOString().slice(0, 10));
  }
  return hasil;
}

// isi dropdown periode (18 periode terakhir, terbaru di atas)
function isiPilihanPeriode() {
  const sel = $('rekap-bulan');
  if (sel.options.length) return;
  let mulai = periodeMulaiSekarang();
  let html = '';
  for (let i = 0; i < 18; i++) {
    const p = periodeDariMulaiJs(mulai);
    html += `<option value="${mulai}">${p.label}</option>`;
    mulai = geserBulan(mulai, -1);
  }
  sel.innerHTML = html;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Foto disimpan di project penyimpanan presensi; URL bertanda tangan diambil
// lewat fungsi server (bukan akses langsung).
async function urlFoto(rec) {
  if (!rec) return null;
  try {
    if (rec.foto_path) {
      const { url } = await api('foto', { path: rec.foto_path });
      return url || null;
    }
    if (rec.arsip_drive_id) {
      const { url } = await api('foto', { id: rec.arsip_drive_id });
      return url || null;
    }
  } catch {
    return null;
  }
  return null;
}

function tampilkan(view) {
  ['login', 'absen', 'rekap'].forEach(v => { $('view-' + v).hidden = v !== view; });
  $('topbar').hidden = view === 'login';
}

// ── mode demo: pratinjau rekap tanpa database (index.html?demo=1) ───────────
function mulaiDemo() {
  profil = { id: 'demo', nama: 'Admin SMP ABBS (demo)', role: 'admin', sekolah_id: 'demo', status: 'aktif' };
  pengaturan = { id: true, lat: -7.539134, lon: 110.805751, radius_m: 50, batas_tot: '06:50:00', batas_masuk: '07:00:00', hari_kerja: [1, 2, 3, 4, 5, 6] };

  $('siapa').textContent = 'Mode demo';
  $('demo-banner').hidden = false;

  rekap.hariIni = tanggalWIB();
  rekap.periode = periodeDariMulaiJs(periodeMulaiSekarang());
  rekap.tanggal = tanggalAntara(rekap.periode.mulai, rekap.periode.selesai);
  rekap.hariKerja = new Set(pengaturan.hari_kerja);
  rekap.libur = new Set([rekap.tanggal[4]]);
  rekap.guru = ['Adila Rahmah, M.Pd', 'Afriyan Moneter Pratama', 'Ahmad Bayu Abdullah, M.Pd',
    'Amien Nur Wicaksono, S.Ag', 'Anni Wijayanti, S.Pd', 'Arif Hidayat, M.Pd',
    'Asnia Novitasari AM, M.E', 'Binti Qoeroti, S.Pd., M.Si',
    'Charlieta Nova Putri Fedito, S.Kom', 'Danang Dwi Pambudi, S.Pd., Gr.',
    'Farida Nur Hidayati, S.Pd', 'Yona Puspa Ningtias, S.Pd., Gr.']
    .map((nama, i) => ({ id: 'd' + i, nama }));

  const peta = new Map();
  rekap.guru.forEach((g, gi) => {
    rekap.tanggal.forEach((tgl, idx) => {
      if (tgl > rekap.hariIni) return;
      if (!rekap.hariKerja.has(isoDow(tgl)) || rekap.libur.has(tgl)) return;
      if ((idx + gi) % 11 === 0) return;                      // dibiarkan alpa
      if ((idx + gi) % 7 === 0) {
        peta.set(g.id + '|' + tgl, {
          status: idx % 2 ? 'izin' : 'sakit', jam: '00:00:00', tepat_waktu: false, terlambat: false,
          jarak_m: null, akurasi_m: null, foto_path: null,
          catatan: idx % 2 ? 'acara keluarga' : 'surat dokter', dicatat_oleh: 'demo'
        });
        return;
      }
      const telat = (idx + gi) % 5 === 0;
      const normal = !telat && (idx + gi) % 4 === 0;
      peta.set(g.id + '|' + tgl, {
        status: 'hadir',
        jam: telat ? '07:12:00' : normal ? '06:55:00' : `06:${String(30 + (idx * 3) % 20).padStart(2, '0')}:00`,
        tepat_waktu: !telat && !normal, terlambat: telat,
        jarak_m: 18 + (idx * gi) % 40, akurasi_m: 8 + idx % 12,
        foto_path: null, catatan: null, dicatat_oleh: null
      });
    });
  });
  rekap.peta = peta;

  isiPilihanPeriode();
  $('rekap-bulan').value = rekap.periode.mulai;
  $('rekap-bulan-label').textContent = rekap.periode.label + ' · Mode demo';
  isiFormPengaturan();
  gambarUlangTabel();
  gambarLibur([{ tanggal: rekap.tanggal[4], keterangan: 'Libur contoh' }]);
  tampilkan('rekap');
}

// ── start ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (location.search.includes('uji')) ujiLogika();
  pasangEvent();
  if (modeDemo) { mulaiDemo(); return; }
  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseKey) {
    tampilkan('login');
    $('login-salah').hidden = false;
    $('login-salah').textContent = 'config.js belum diisi (supabaseUrl / supabaseKey).';
    return;
  }
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) await sesudahLogin();
  else tampilkan('login');
});

function pasangEvent() {
  $('form-login').addEventListener('submit', masuk);
  $('tombol-keluar').addEventListener('click', keluar);
  $('tombol-absen').addEventListener('click', kirimAbsen);
  $('tombol-lokasi').addEventListener('click', perbaruiLokasi);
  $('rekap-bulan').addEventListener('change', muatRekap);
  $('riwayat-mundur').addEventListener('click', () => {
    if (riwayatPeriode) muatRiwayat(geserBulan(riwayatPeriode.mulai, -1));
  });
  $('riwayat-maju').addEventListener('click', () => {
    if (riwayatPeriode) muatRiwayat(geserBulan(riwayatPeriode.mulai, 1));
  });
  $('rekap-cari').addEventListener('input', gambarUlangTabel);
  $('rekap-excel').addEventListener('click', unduhExcel);
  $('rekap-cetak').addEventListener('click', () => window.print());
  $('tirai').addEventListener('click', (e) => { if (e.target.id === 'tirai') tutupModal(); });
  $('set-simpan').addEventListener('click', simpanPengaturan);
  $('set-arsip').addEventListener('click', arsipkanPeriodeLalu);
  $('rekap-pengaturan').addEventListener('click', bukaPengaturan);
  $('pengaturan-tutup').addEventListener('click', tutupPengaturan);
  $('tirai-pengaturan').addEventListener('click', (e) => { if (e.target.id === 'tirai-pengaturan') tutupPengaturan(); });
  $('set-lokasi-saya').addEventListener('click', () => ambilLokasiSekali($('set-lat'), $('set-lon'), $('set-info')));
  $('libur-tambah').addEventListener('click', tambahLibur);

  // tabel (desktop) dan kartu (HP) digambar ulang saat layar berubah lebar
  let tunda;
  window.addEventListener('resize', () => {
    clearTimeout(tunda);
    tunda = setTimeout(() => {
      if (!$('view-rekap').hidden && rekap.guru.length) gambarUlangTabel();
    }, 200);
  });
}

// ── auth ────────────────────────────────────────────────────────────────────
// Akun LMS memakai email sintetis username@examfilq.dev (bukan email asli),
// jadi login cukup dari username. Password tidak pernah disalin ke aplikasi ini:
// kata sandi yang dipakai adalah kata sandi LMS (hash-nya tidak bisa dibaca).
const DOMAIN_LMS = 'examfilq.dev';

async function cariEmail(username) {
  if (username.includes('@')) return username;

  // 1. fungsi aplikasi ini (guru + admin), ada setelah migration dijalankan
  let { data, error } = await db.rpc('absensi_login_email', { p_username: username });
  if (!error && data) return data;

  // 2. fungsi bawaan LMS (hanya role guru) — sudah ada di produksi
  ({ data, error } = await db.rpc('get_email_by_username', { p_username: username }));
  if (!error && data) return data;

  // 3. pola akun LMS; salah username akan ditolak saat signIn (pesan tetap umum)
  return `${username}@${DOMAIN_LMS}`;
}

async function masuk(e) {
  e.preventDefault();
  const tombol = $('login-masuk');
  const salah = $('login-salah');
  salah.hidden = true;
  tombol.disabled = true;
  tombol.textContent = 'Memeriksa…';

  const username = $('login-username').value.trim();
  const password = $('login-password').value;

  try {
    const email = await cariEmail(username);
    if (!email) throw new Error('Username atau kata sandi salah.');

    const { data, error: err } = await db.auth.signInWithPassword({ email, password });
    if (err) throw new Error('Username atau kata sandi salah.');

    await sesudahLogin();
    $('login-password').value = '';
  } catch (err) {
    salah.textContent = err.message;
    salah.hidden = false;
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Masuk';
  }
}

async function keluar() {
  hentikanLokasi();
  hentikanKamera();
  sudahAbsen = false;
  izinKameraGagal = false;
  await db.auth.signOut();
  profil = null;
  pengaturan = null;
  tampilkan('login');
}

// ── API ke Edge Function "absen" (project penyimpanan presensi) ─────────────
// Token login LMS dikirim apa adanya; fungsi di server yang memverifikasinya.
async function api(action, isi = {}) {
  const { data: { session } } = await db.auth.getSession();
  const token = session?.access_token || '';

  let r;
  try {
    r = await fetch(`${APP_CONFIG.dataUrl}/functions/v1/absen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: APP_CONFIG.dataKey,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action, ...isi })
    });
  } catch {
    throw new Error('Tidak bisa menghubungi server absensi. Periksa koneksi internet.');
  }

  const j = await r.json().catch(() => ({}));

  if (r.status === 401) {
    await db.auth.signOut();
    profil = null;
    tampilkan('login');
    throw new Error(j.message || 'Sesi habis, silakan login ulang.');
  }
  if (!r.ok) throw new Error(j.message || `Server menolak permintaan (${r.status}).`);
  return j;
}

async function sesudahLogin() {
  let boot;
  try {
    boot = await api('boot');
  } catch (err) {
    await db.auth.signOut();
    tampilkan('login');
    $('login-salah').hidden = false;
    $('login-salah').textContent = err.message;
    return;
  }

  profil = boot.profil;
  pengaturan = boot.pengaturan;
  absenHariIni = boot.hariIni || null;
  periodeSekarang = boot.periode?.periode?.mulai || null;
  $('siapa').textContent = profil.nama || profil.username || '';

  if (boot.adminSekolah) {
    isiPilihanPeriode();
    tampilkan('rekap');
    await muatRekap();
  } else if (boot.guruSekolah) {
    tampilkan('absen');
    tampilkanAbsen(boot);
    await muatRiwayat();
  } else {
    await db.auth.signOut();
    tampilkan('login');
    $('login-salah').hidden = false;
    $('login-salah').textContent = 'Akun ini bukan guru/admin aktif SMP ABBS.';
  }
}

// ── absen (guru) ────────────────────────────────────────────────────────────
function tampilkanAbsen(boot) {
  const tgl = boot.tanggal || tanggalWIB();
  $('absen-halo').textContent = 'Assalamu\'alaikum, ' + (profil.nama || '').replace(/,.*$/, '');
  $('absen-tanggal').textContent = tanggalPanjang(tgl) + ' · ' + (boot.jam || jamWIB()) + ' WIB';

  if (!pengaturan) {
    $('kartu-kamera').hidden = true;
    $('info-pesan').textContent = 'Pengaturan absensi belum dibuat. Hubungi admin.';
    $('info-pesan').className = 'pesan salah';
    return;
  }
  $('info-tot').textContent = potongJam(pengaturan.batas_tot) + ' WIB';
  $('info-masuk').textContent = potongJam(pengaturan.batas_masuk || '07:00:00') + ' WIB';
  $('info-radius').textContent = pengaturan.radius_m + ' m';

  renderPeriode(boot.periode);

  $('kartu-kamera').hidden = false;
  $('kartu-status').hidden = false;
  $('kartu-sukses').hidden = true;

  if (boot.hariIni?.jam) {
    sudahAbsen = true;
    tampilkanHasil(boot.hariIni);
  } else {
    sudahAbsen = false;
    // kamera baru dinyalakan saat lokasi sudah masuk radius (lihat renderLokasi)
    $('kamera-luar').hidden = false;
    $('kamera-status').textContent = 'Menunggu lokasi…';
    mulaiLokasi();
  }
}

function renderPeriode(data) {
  if (!data?.periode) return;
  $('kartu-periode').hidden = false;
  $('periode-label').textContent = data.periode.label;
  $('p-tot').textContent = data.total.tot;
  $('p-terlambat').textContent = data.total.terlambat;
  $('p-hadir').textContent = data.total.hadir;
  $('p-sakit').textContent = data.total.sakit;
  $('p-izin').textContent = data.total.izin;
  $('p-alpa').textContent = data.total.alpa;
  $('p-efektif').textContent = data.efektif;
  $('periode-persen').textContent = data.persen + '%';
  $('periode-persen').className = 'lencana ' + (data.persen >= 80 ? 'ok' : data.persen >= 50 ? 'peringatan' : 'bahaya');
}

function labelStatus(rec) {
  if (!rec) return 'Belum absen';
  if (rec.status !== 'hadir') {
    return rec.status.charAt(0).toUpperCase() + rec.status.slice(1);
  }
  if (rec.dicatat_oleh) return 'Hadir (dicatat admin)';
  if (rec.kebijakan) return 'Tepat waktu (kebijakan)';
  if (rec.tepat_waktu) return 'Tepat waktu (TOT)';
  if (rec.terlambat) return 'Terlambat';
  return 'Hadir';
}

function tampilkanHasil(rec, baruDikirim = false) {
  sudahAbsen = true;
  hentikanLokasi();
  hentikanKamera();
  $('kartu-kamera').hidden = true;
  $('kartu-status').hidden = true;
  $('kartu-sukses').hidden = false;

  const status = labelStatus(rec);
  $('sukses-jam').textContent = potongJam(rec.jam) === '00:00' ? '—' : potongJam(rec.jam);
  $('sukses-status').textContent = status;
  const kelas = rec.status !== 'hadir' ? 'bahaya' : rec.tepat_waktu ? 'ok' : rec.terlambat ? 'peringatan' : 'netral';
  $('sukses-status').className = kelas;
  $('kartu-sukses').classList.toggle('baru', baruDikirim);
}

function mulaiLokasi() {
  if (sudahAbsen) return;
  if (!navigator.geolocation) {
    $('info-pesan').textContent = 'Perangkat ini tidak mendukung GPS.';
    return;
  }
  if (pengamatLokasi != null) navigator.geolocation.clearWatch(pengamatLokasi);
  pengamatLokasi = navigator.geolocation.watchPosition(
    (p) => {
      posisi = { lat: p.coords.latitude, lon: p.coords.longitude, akurasi: p.coords.accuracy };
      renderLokasi();
    },
    (err) => {
      $('info-pesan').textContent = 'Lokasi belum terbaca. Aktifkan GPS dan izinkan akses lokasi. (' + err.message + ')';
      $('info-pesan').className = 'pesan salah';
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
}

function renderLokasi() {
  if (!posisi || !pengaturan) return;
  if (sudahAbsen) return;   // sudah absen: kamera & lokasi tidak dipakai lagi
  const jarak = haversine(posisi.lat, posisi.lon, pengaturan.lat, pengaturan.lon);
  const radius = pengaturan.radius_m;
  const dalam = jarak <= radius;
  const keluar = jarak > radius + 10;   // toleransi 10 m supaya tidak kedip saat GPS bergeser
  dalamRadius = dalam;

  $('info-jarak').textContent = Math.round(jarak) + ' m';
  $('info-akurasi').textContent = '±' + Math.round(posisi.akurasi) + ' m';

  const pesan = $('info-pesan');
  const status = $('kamera-status');
  const luar = $('kamera-luar');

  luar.hidden = dalam;
  $('kamera-luar-jarak').textContent = dalam
    ? `${Math.round(jarak)} m dari titik sekolah`
    : `${Math.round(jarak)} m dari titik sekolah — maksimal ${radius} m`;

  if (dalam) {
    pesan.textContent = 'Di dalam radius absen. Ambil foto lalu tekan Kirim Absen.';
    pesan.className = 'pesan info';
    if (!stream && !memintaKamera && !izinKameraGagal) siapkanKamera();
    if (stream) {
      status.textContent = 'Kamera siap. Wajah Anda terlihat?';
      $('tombol-absen').hidden = false;
      $('tombol-absen').disabled = false;
    }
  } else {
    pesan.textContent = `Anda ${Math.round(jarak)} m dari titik sekolah, maksimal ${radius} m. Foto hanya bisa diambil di dalam radius.`;
    pesan.className = 'pesan salah';
    status.textContent = 'Menunggu Anda masuk radius sekolah…';
    if (keluar && stream) hentikanKamera();
    $('tombol-absen').hidden = true;
    $('tombol-absen').disabled = true;
  }
}

async function siapkanKamera() {
  if (sudahAbsen) return;
  const kotak = $('kamera-kosong');
  const status = $('kamera-status');
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Perangkat ini tidak mendukung kamera.';
    izinKameraGagal = true;
    return;
  }
  if (memintaKamera || stream) return;

  memintaKamera = true;
  kotak.hidden = false;
  kotak.textContent = 'Menunggu izin kamera…';
  status.textContent = 'Menunggu izin kamera…';

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });

    // kalau ternyata sudah keluar radius saat izin diberikan, langsung matikan
    if (!dalamRadius) { hentikanKamera(); return; }

    const v = $('video');
    v.srcObject = stream;
    v.hidden = false;
    kotak.hidden = true;
    status.textContent = 'Kamera siap. Wajah Anda terlihat?';
    $('tombol-absen').hidden = false;
    $('tombol-absen').disabled = false;
  } catch (err) {
    izinKameraGagal = true;
    stream = null;
    matikanVideo();
    kotak.hidden = false;
    kotak.innerHTML = 'Izin kamera belum aktif.<br>Muat ulang halaman untuk meminta izin lagi.';
    status.textContent = 'Kamera tidak aktif.';
    $('tombol-absen').hidden = true;
  } finally {
    memintaKamera = false;
  }
}

function matikanVideo() {
  const v = $('video');
  v.hidden = true;
  if (v.srcObject) { try { v.srcObject.getTracks().forEach(t => t.stop()); } catch (e) { /* sudah mati */ } v.srcObject = null; }
}

function hentikanKamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  matikanVideo();
  $('kamera-kosong').hidden = false;
  $('tombol-absen').hidden = true;
}

function perbaruiLokasi() {
  posisi = null;
  $('info-jarak').textContent = '—';
  $('info-akurasi').textContent = '—';
  $('info-pesan').textContent = 'Mencari lokasi terbaru…';
  $('info-pesan').className = 'pesan info';
  $('tombol-absen').disabled = true;

  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
    (p) => {
      posisi = { lat: p.coords.latitude, lon: p.coords.longitude, akurasi: p.coords.accuracy };
      renderLokasi();
    },
    (err) => {
      $('info-pesan').textContent = 'Lokasi gagal diambil: ' + err.message;
      $('info-pesan').className = 'pesan salah';
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
  mulaiLokasi();
}

async function kirimAbsen() {
  if (!posisi) return toast('Lokasi belum terbaca.');
  if (!dalamRadius) return toast('Anda di luar radius sekolah. Foto hanya bisa diambil di dalam radius.');
  if (!stream) return toast('Kamera belum aktif. Tunggu sampai kamera siap.');
  const tombol = $('tombol-absen');
  tombol.disabled = true;
  tombol.textContent = 'Mengirim…';

  try {
    const v = $('video'), c = $('canvas');
    if (!v.videoWidth) throw new Error('Kamera belum siap. Tunggu sebentar.');
    const foto = fotoKompres(v, c);

    const data = await api('absen', {
      lat: posisi.lat, lon: posisi.lon, akurasi: posisi.akurasi, foto
    });

    if (!data.ok) {
      if (data.code === 'SUDAH') {
        tampilkanHasil({ ...data, status: 'hadir' });
        await muatRiwayat();
      }
      toast(data.message || 'Absen ditolak.');
      tombol.disabled = false;
      tombol.textContent = 'Absen Sekarang';
      return;
    }

    tampilkanHasil({
      tanggal: data.tanggal, jam: data.jam, status: 'hadir',
      tepat_waktu: data.tepat_waktu, jarak_m: data.jarak
    }, true);
    toast('Absen berhasil terkirim.');
    await muatRiwayat();
    try { renderPeriode(await api('rekap_saya')); } catch { /* ringkasan opsional */ }
  } catch (err) {
    toast(err.message);
    tombol.disabled = false;
    tombol.textContent = 'Absen Sekarang';
  }
}

async function muatRiwayat(mulai) {
  const daftar = $('riwayat');
  let data;
  try {
    data = await api('riwayat', mulai ? { mulai } : {});
  } catch (err) {
    daftar.innerHTML = `<li class="riwayat-kosong">${err.message}</li>`;
    return;
  }

  riwayatPeriode = data.periode;
  $('riwayat-periode').textContent = data.periode.label;
  $('riwayat-maju').disabled = !periodeSekarang || data.periode.mulai >= periodeSekarang;
  $('riwayat-mundur').disabled = false;

  const r = data.ringkasan || {};
  const chip = (label, nilai) => `<div class="chip">${label} <b>${nilai ?? 0}</b></div>`;
  $('riwayat-ringkas').innerHTML =
    chip('Masuk', r.masuk) + chip('Tepat waktu', r.tot) + chip('Terlambat', r.terlambat) +
    chip('Izin', r.izin) + chip('Sakit', r.sakit) + chip('Alpa', r.alpa) +
    chip('Belum absen', r.belum) +
    `<div class="chip chip-persen">Kehadiran <b>${r.persen ?? 0}%</b></div>`;

  daftar.innerHTML = (data.hari || []).map(h => {
    const { label, kelas } = statusHari(h);
    const tgl = new Date(h.tanggal + 'T00:00:00');
    const hariKe = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][tgl.getDay()];
    const iniHari = h.tanggal === data.hariIni ? ' rb-ini' : '';

    const rinci = [];
    if (h.jam && h.jam !== '00:00') rinci.push(`<span class="rb-jam">${h.jam}</span>`);
    if (h.jarak_m != null) rinci.push(`<span class="rb-jarak">${Math.round(h.jarak_m)} m</span>`);
    if (h.catatan) rinci.push(`<span class="rb-catatan">${h.catatan}</span>`);

    return `<li class="rb${iniHari}">
      <span class="rb-tgl"><b>${Number(h.tanggal.slice(8))}</b><i>${hariKe}</i></span>
      <span class="rb-status ${kelas}">${label}</span>
      <span class="rb-rinci">${rinci.join('')}</span>
    </li>`;
  }).join('') || '<li class="riwayat-kosong">Belum ada data pada periode ini.</li>';
}

function statusHari(h) {
  if (h.status === 'hadir') {
    if (h.tepat_waktu) return { label: 'Tepat waktu', kelas: 'ok' };
    if (h.terlambat) return { label: 'Terlambat', kelas: 'peringatan' };
    return { label: 'Hadir', kelas: 'netral' };
  }
  if (h.status === 'libur') return { label: 'Libur', kelas: 'abu' };
  if (h.status === 'akan') return { label: '—', kelas: 'abu' };
  if (h.status === 'belum') return { label: 'Belum absen', kelas: 'kosong' };
  if (h.status === 'izin') return { label: 'Izin', kelas: 'ungu' };
  if (h.status === 'sakit') return { label: 'Sakit', kelas: 'biru' };
  if (h.status === 'alpa') return { label: 'Alpa', kelas: 'bahaya' };
  return { label: h.status, kelas: 'abu' };
}

// ── rekap (admin) ───────────────────────────────────────────────────────────
async function muatRekap() {
  if (modeDemo) return;
  if (!profil || profil.role !== 'admin') return;

  const mulai = $('rekap-bulan').value || periodeMulaiSekarang();
  $('rekap-bulan').value = mulai;
  rekap.hariIni = tanggalWIB();

  let data;
  try {
    data = await api('rekap', { mulai });
  } catch (err) {
    toast(err.message);
    return;
  }

  rekap.periode = data.periode || periodeDariMulaiJs(mulai);
  rekap.tanggal = tanggalAntara(rekap.periode.mulai, rekap.periode.selesai);
  $('rekap-bulan-label').textContent = rekap.periode.label + ' · ' + (profil.nama || '');

  pengaturan = data.pengaturan || pengaturan;
  rekap.hariKerja = new Set(pengaturan?.hari_kerja || [1, 2, 3, 4, 5, 6]);
  rekap.guru = data.guru || [];
  rekap.peta = new Map((data.rows || []).map(r => [r.user_id + '|' + r.tanggal, r]));
  rekap.liburDaftar = data.libur || [];
  rekap.libur = new Set(rekap.liburDaftar.map(r => r.tanggal));

  if (pengaturan) isiFormPengaturan();
  gambarUlangTabel();
  gambarLibur(data.libur || []);
}

function kodeSel(uid, tgl) {
  const dow = isoDow(tgl);
  if (rekap.libur.has(tgl) || !rekap.hariKerja.has(dow)) return { k: 'L', c: 'k-l' };
  const rec = rekap.peta.get(uid + '|' + tgl);
  if (rec) {
    if (rec.status === 'hadir') {
      if (rec.tepat_waktu) return { k: 'TOT', c: 'k-tot' };      // <= batas TOT
      if (rec.terlambat) return { k: 'TL', c: 'k-tl' };          // > jam masuk
      return { k: 'H', c: 'k-h' };                               // masuk biasa / dicatat admin
    }
    return { k: rec.status === 'sakit' ? 'S' : rec.status === 'izin' ? 'I' : 'A', c: 'k-' + (rec.status === 'sakit' ? 's' : rec.status === 'izin' ? 'i' : 'a') };
  }
  if (tgl >= rekap.hariIni) return { k: '', c: 'k-kosong' };  // hari ini/belum lewat
  return { k: 'A', c: 'k-a' };
}

function selTampil(uid, tgl) {
  const { k, c } = kodeSel(uid, tgl);
  const rec = rekap.peta.get(uid + '|' + tgl);
  const hari = `${HARI[isoDow(tgl) - 1]}, ${Number(tgl.slice(8))} ${bulanPanjang(tgl.slice(0, 7)).split(' ')[0]}`;

  if (!k) return { teks: '', kelas: c, judul: `${hari}: belum absen` };
  if (k === 'L') return { teks: 'L', kelas: c, judul: `${hari}: libur` };

  // hadir: tampilkan jam absennya, warna mengikuti status
  if (rec && rec.status === 'hadir' && !rec.dicatat_oleh) {
    const jam = potongJam(rec.jam);
    if (rec.kebijakan && (!jam || jam === '00:00')) {
      return { teks: 'TOT*', kelas: c, judul: `${hari}: tepat waktu (kebijakan manajemen unit)` };
    }
    return {
      teks: jam || 'H',
      kelas: c,
      judul: `${hari}: ${labelStatus(rec)}${jam ? ' pukul ' + jam : ''}`
    };
  }
  if (k === 'H') return { teks: 'H', kelas: c, judul: `${hari}: ${labelStatus(rec)}` };
  if (!rec) return { teks: k, kelas: c, judul: `${hari}: ${k === 'A' ? 'alpa (tidak ada absen)' : k}` };
  return { teks: k, kelas: c, judul: `${hari}: ${labelStatus(rec)}` };
}

function hitungTotal(uid) {
  const t = { tot: 0, tl: 0, h: 0, s: 0, i: 0, a: 0, efektif: 0 };
  for (const tgl of rekap.tanggal) {
    const kerja = rekap.hariKerja.has(isoDow(tgl)) && !rekap.libur.has(tgl);
    if (kerja && tgl <= rekap.hariIni) t.efektif++;
    const k = kodeSel(uid, tgl).k;
    if (k === 'TOT') t.tot++;
    else if (k === 'TL') t.tl++;
    else if (k === 'H') t.h++;
    else if (k === 'S') t.s++;
    else if (k === 'I') t.i++;
    else if (k === 'A') t.a++;
  }
  t.hadir = t.tot + t.tl + t.h;
  t.persen = t.efektif ? Math.round((t.hadir / t.efektif) * 100) : 0;
  return t;
}

function gambarUlangTabel() {
  const cari = $('rekap-cari').value.trim().toLowerCase();
  const thead = document.querySelector('#tabel-rekap thead');
  const tbody = document.querySelector('#tabel-rekap tbody');

  let h = '<tr><th class="nama">Guru</th>';
  for (const tgl of rekap.tanggal) {
    const bulan = BULAN_PENDEK[Number(tgl.slice(5, 7)) - 1];
    h += `<th title="${HARI[isoDow(tgl) - 1]}, ${Number(tgl.slice(8))} ${bulan}">${Number(tgl.slice(8))}<i>${bulan}</i></th>`;
  }
  h += '<th class="total">TOT</th><th class="total">TL</th><th class="total">H</th><th class="total">S</th>'
     + '<th class="total">I</th><th class="total">A</th><th class="total">%</th></tr>';
  thead.innerHTML = h;

  let rows = '', ringkas = { guru: 0, hadir: 0, tot: 0, tl: 0 };
  const hariIniPeriode = rekap.tanggal.includes(rekap.hariIni) ? rekap.hariIni : null;

  for (const g of rekap.guru) {
    if (cari && !(g.nama || '').toLowerCase().includes(cari)) continue;
    ringkas.guru++;

    let tr = `<tr><td class="nama" title="${g.nama || ''}">${g.nama || '-'}</td>`;
    for (const tgl of rekap.tanggal) {
      const sel = selTampil(g.id, tgl);
      tr += `<td class="sel ${sel.kelas}" data-uid="${g.id}" data-tgl="${tgl}" title="${sel.judul}">${sel.teks}</td>`;
    }
    const t = hitungTotal(g.id);
    tr += `<td class="total">${t.tot}</td><td class="total">${t.tl}</td><td class="total">${t.h}</td><td class="total">${t.s}</td>`
        + `<td class="total">${t.i}</td><td class="total">${t.a}</td><td class="total">${t.persen}%</td></tr>`;
    rows += tr;

    const rec = hariIniPeriode ? rekap.peta.get(g.id + '|' + hariIniPeriode) : null;
    if (rec) { ringkas.hadir++; if (rec.status === 'hadir' && rec.tepat_waktu) ringkas.tot++; if (rec.status === 'hadir' && !rec.tepat_waktu) ringkas.tl++; }
  }

  tbody.innerHTML = rows || '<tr><td colspan="40" style="padding:20px;color:var(--teks-lembut)">Tidak ada guru yang cocok.</td></tr>';

  tbody.querySelectorAll('td.sel').forEach(td => {
    td.addEventListener('click', () => bukaModal(td.dataset.uid, td.dataset.tgl));
  });

  $('rekap-ringkas').innerHTML = `
    <div class="chip">Guru <b>${ringkas.guru}</b></div>
    <div class="chip">Absen hari ini <b>${ringkas.hadir}</b></div>
    <div class="chip">TOT hari ini <b>${ringkas.tot}</b></div>
    <div class="chip">Terlambat hari ini <b>${ringkas.tl}</b></div>
    <div class="chip">Total TOT periode ini <b>${rekap.guru.reduce((n, g) => n + hitungTotal(g.id).tot, 0)}</b></div>`;

  gambarKartuHp(cari);
}

// Versi HP: satu kartu per guru berisi kalender mini (tabel terlalu lebar di layar kecil)
function gambarKartuHp(cari) {
  const box = $('rekap-hp');
  if (!box) return;
  if (!window.matchMedia('(max-width: 760px)').matches) { box.innerHTML = ''; return; }

  let html = '';
  const offset = isoDow(rekap.tanggal[0]) - 1;

  for (const g of rekap.guru) {
    if (cari && !(g.nama || '').toLowerCase().includes(cari)) continue;

    const t = hitungTotal(g.id);
    const kelas = t.persen >= 80 ? 'ok' : t.persen >= 50 ? 'peringatan' : 'bahaya';

    let kal = '<span class="hp-hari kosong"></span>'.repeat(offset);
    for (const tgl of rekap.tanggal) {
      const sel = selTampil(g.id, tgl);
      const jam = sel.kelas === 'k-tot' || sel.kelas === 'k-tl' ? sel.teks : '';
      kal += `<button class="hp-hari ${sel.kelas}" data-uid="${g.id}" data-tgl="${tgl}" title="${sel.judul}">
        <span class="hp-tgl">${Number(tgl.slice(8))}</span>${jam ? `<span class="hp-jam">${jam}</span>` : ''}
      </button>`;
    }

    html += `<article class="hp-kartu">
      <div class="hp-kepala"><strong>${g.nama || '-'}</strong><span class="lencana ${kelas}">${t.persen}%</span></div>
      <div class="hp-total">
        <span>Tepat waktu <b>${t.tot}</b></span><span>Terlambat <b>${t.tl}</b></span>
        <span>Masuk <b>${t.hadir}</b></span><span>Sakit <b>${t.s}</b></span>
        <span>Izin <b>${t.i}</b></span><span>Alpa <b>${t.a}</b></span>
      </div>
      <div class="hp-kalender">${kal}</div>
    </article>`;
  }

  box.innerHTML = html || '<p style="color:var(--teks-lembut);font-size:13px">Tidak ada guru yang cocok.</p>';
  box.querySelectorAll('button[data-uid]').forEach(b => {
    b.addEventListener('click', () => bukaModal(b.dataset.uid, b.dataset.tgl));
  });
}

// ── modal sel ───────────────────────────────────────────────────────────────
let modalAktif = null;

function bukaModal(uid, tgl) {
  const guru = rekap.guru.find(g => g.id === uid);
  const rec = rekap.peta.get(uid + '|' + tgl);
  const kode = kodeSel(uid, tgl).k;
  const jamTeks = potongJam(rec?.jam) === '00:00' ? '—' : potongJam(rec?.jam);
  const statusTeks = !rec ? '' : labelStatus(rec);
  modalAktif = { uid, tgl };

  $('modal').innerHTML = `
    <h2>${guru?.nama || '-'}</h2>
    <div class="meta">${tanggalPanjang(tgl)} · ${kode || 'belum absen'}</div>
    ${(rec?.foto_path || rec?.foto_dihapus) ? '<div id="modal-foto" style="color:var(--ink-lembut);font-size:12.5px">memuat foto…</div>' : ''}
    ${rec ? `<div class="status-baris"><span>Jam</span><span class="nilai">${jamTeks}</span></div>
      <div class="status-baris"><span>Status</span><span class="nilai">${statusTeks}</span></div>
      <div class="status-baris"><span>Jarak</span><span class="nilai">${rec.jarak_m != null ? Math.round(rec.jarak_m) + ' m' : '—'}</span></div>
      <div class="status-baris"><span>Akurasi</span><span class="nilai">${rec.akurasi_m != null ? '±' + Math.round(rec.akurasi_m) + ' m' : '—'}</span></div>` : '<p style="font-size:14px;color:var(--teks-lembut)">Belum ada data absensi pada tanggal ini.</p>'}

    ${rec?.diubah_at ? `<p style="font-size:11.5px;color:var(--ink-lembut);margin-top:8px">Terakhir diubah admin.</p>` : ''}

    <div class="bidang" style="margin-top:14px">
      <label for="modal-jam">Jam kehadiran (bisa dikoreksi admin)</label>
      <input type="time" id="modal-jam" value="${jamTeks === '—' ? '' : jamTeks}">
    </div>
    <div class="bidang">
      <label for="modal-catatan">Catatan (opsional)</label>
      <input type="text" id="modal-catatan" value="${(rec?.catatan || '').replace(/"/g, '&quot;')}" placeholder="mis. surat dokter">
    </div>
    <div class="aksi">
      <button class="tombol kecil" data-set="jam">Simpan jam</button>
      <button class="tombol putih kecil" data-set="hadir">Hadir</button>
      <button class="tombol putih kecil" data-set="izin">Izin</button>
      <button class="tombol putih kecil" data-set="sakit">Sakit</button>
      <button class="tombol putih kecil" data-set="alpa">Alpa</button>
      <button class="tombol putih kecil" data-set="hapus" style="color:var(--merah)">Hapus</button>
      <button class="tombol putih kecil" id="modal-tutup">Tutup</button>
    </div>`;

  $('tirai').hidden = false;
  $('modal-tutup').addEventListener('click', tutupModal);
  $('modal').querySelectorAll('[data-set]').forEach(b => {
    b.addEventListener('click', () => setStatus(b.dataset.set));
  });

  if (rec?.foto_dihapus && !rec.foto_path) {
    const box = $('modal-foto');
    if (box) {
      box.outerHTML =
        '<p style="font-size:12.5px;color:var(--ink-lembut)">Foto sudah dibersihkan otomatis (melewati batas simpan). Data absen tetap tersimpan.</p>';
    }
  }

  if (rec?.foto_path) {
    urlFoto(rec).then(u => {
      const box = $('modal-foto');
      if (!box) return;
      box.outerHTML = u ? `<img src="${u}" alt="Foto absen">` : '<p style="font-size:12.5px;color:var(--ink-lembut)">Foto tidak tersedia.</p>';
    });
  }
}

function tutupModal() {
  $('tirai').hidden = true;
  $('modal').innerHTML = '';
  modalAktif = null;
}

async function setStatus(aksi) {
  if (modeDemo) return toast('Mode demo: perubahan tidak disimpan.');
  if (!modalAktif) return;
  const catatan = $('modal-catatan')?.value || null;
  const jam = $('modal-jam')?.value || '';

  if (aksi === 'jam' && !jam) return toast('Isi jam kehadiran dulu.');

  try {
    await api('set_status', {
      user_id: modalAktif.uid,
      tanggal: modalAktif.tgl,
      status: aksi === 'hapus' || aksi === 'jam' ? 'hadir' : aksi,
      catatan,
      jam: aksi === 'jam' ? jam : undefined,
      hapus: aksi === 'hapus'
    });
  } catch (err) {
    return toast(err.message);
  }
  tutupModal();
  toast(aksi === 'jam' ? 'Jam kehadiran diperbarui.' : 'Status diperbarui.');
  await muatRekap();
}

// ── pengaturan & libur ──────────────────────────────────────────────────────
function isiFormPengaturan() {
  if (!pengaturan) return;
  $('set-lat').value = pengaturan.lat;
  $('set-lon').value = pengaturan.lon;
  $('set-radius').value = pengaturan.radius_m;
  $('set-tot').value = potongJam(pengaturan.batas_tot);
  $('set-masuk').value = potongJam(pengaturan.batas_masuk || '07:00:00');
  $('set-pengecualian').value = (pengaturan.pengecualian_tot || []).join(', ');


  const box = $('set-hari');
  if (!box.dataset.siap) {
    box.innerHTML = HARI.map((nama, i) =>
      `<label><input type="checkbox" value="${i + 1}"> ${nama.slice(0, 3)}</label>`).join('');
    box.dataset.siap = '1';
  }
  const aktif = new Set(pengaturan.hari_kerja || []);
  box.querySelectorAll('input').forEach(cb => { cb.checked = aktif.has(Number(cb.value)); });
}

async function simpanPengaturan() {
  if (modeDemo) return toast('Mode demo: pengaturan tidak disimpan.');
  if (!profil || profil.role !== 'admin') return;
  const hari = [...$('set-hari').querySelectorAll('input:checked')].map(c => Number(c.value));
  if (!hari.length) return toast('Pilih minimal satu hari kerja.');

  const isi = {
    lat: Number($('set-lat').value),
    lon: Number($('set-lon').value),
    radius_m: Math.round(Number($('set-radius').value)),
    batas_tot: $('set-tot').value,
    batas_masuk: $('set-masuk').value,
    pengecualian_tot: $('set-pengecualian').value
      .split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean),

    hari_kerja: hari
  };
  if (!Number.isFinite(isi.lat) || !Number.isFinite(isi.lon)) return toast('Koordinat tidak valid.');
  if (!(isi.radius_m >= 10 && isi.radius_m <= 5000)) return toast('Radius harus 10–5000 meter.');
  if (!isi.batas_masuk) return toast('Jam masuk belum diisi.');
  if (isi.batas_masuk <= isi.batas_tot) return toast('Jam masuk harus setelah batas TOT.');

  try {
    await api('simpan_pengaturan', isi);
  } catch (err) {
    return toast(err.message);
  }

  pengaturan = { ...pengaturan, ...isi };
  rekap.hariKerja = new Set(hari);
  toast('Pengaturan disimpan.');
  await muatRekap();
}

function ambilLokasiSekali(inputLat, inputLon, info) {
  if (!navigator.geolocation) return toast('Perangkat tidak mendukung GPS.');
  if (info) info.textContent = 'mengambil lokasi…';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      inputLat.value = p.coords.latitude.toFixed(6);
      inputLon.value = p.coords.longitude.toFixed(6);
      if (info) info.textContent = `akurasi ±${Math.round(p.coords.accuracy)} m — tekan Simpan`;
    },
    (err) => {
      if (info) info.textContent = '';
      toast('Gagal mengambil lokasi: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 20000 }
  );
}

function gambarLibur(daftar) {
  $('libur-daftar').innerHTML = daftar.map(l =>
    `<span class="libur-item">${l.tanggal.split('-').reverse().join('/')}${l.keterangan ? ' · ' + l.keterangan : ''}
      <button data-hapus="${l.tanggal}" title="Hapus">×</button></span>`).join('')
    || '<span style="font-size:13px;color:var(--teks-lembut)">Belum ada hari libur bulan ini.</span>';

  $('libur-daftar').querySelectorAll('[data-hapus]').forEach(b => {
    b.addEventListener('click', async () => {
      if (modeDemo) return toast('Mode demo: hari libur tidak disimpan.');
      try {
        await api('libur_hapus', { tanggal: b.dataset.hapus });
      } catch (err) {
        return toast(err.message);
      }
      await muatRekap();
    });
  });
}

async function tambahLibur() {
  if (modeDemo) return toast('Mode demo: hari libur tidak disimpan.');
  const tanggal = $('libur-tanggal').value;
  const keterangan = $('libur-ket').value.trim();
  if (!tanggal) return toast('Pilih tanggal libur.');
  try {
    await api('libur_tambah', { tanggal, keterangan: keterangan || null });
  } catch (err) {
    return toast(err.message);
  }
  $('libur-tanggal').value = '';
  $('libur-ket').value = '';
  toast('Hari libur ditambahkan.');
  await muatRekap();
}

// ── export Excel (xlsx berformat) ───────────────────────────────────────────
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

function muatExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (muatExcelJS._janji) return muatExcelJS._janji;

  muatExcelJS._janji = new Promise((selesai, gagal) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = () => selesai(window.ExcelJS);
    s.onerror = () => gagal(new Error('Gagal memuat pustaka Excel. Periksa koneksi internet.'));
    document.head.appendChild(s);
  });
  return muatExcelJS._janji;
}

const HURUF_HARI = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];

async function unduhExcel() {
  const tombol = $('rekap-excel');
  const teksAsli = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Menyiapkan…';

  try {
    const ExcelJS = await muatExcelJS();

    const tanggal = rekap.tanggal;
    const jumlahHari = tanggal.length;
    const periodeLabel = rekap.periode?.label || '';
    const kolomAwalHari = 3;
    const kolomTotal = kolomAwalHari + jumlahHari;
    const kolomAkhir = kolomTotal + 6;
    const kolomKode = ['TOT', 'TL', 'H', 'S', 'I', 'A'];

    const WARNA = {
      tot: { isi: 'FFE7F6EE', teks: 'FF0A5C4B' },
      tl: { isi: 'FFFDF3D9', teks: 'FF7A4F00' },
      h: { isi: 'FFEEF2F1', teks: 'FF3A5A63' },
      s: { isi: 'FFE7F3FB', teks: 'FF1A5680' },
      i: { isi: 'FFF1ECFA', teks: 'FF5B3D85' },
      a: { isi: 'FFFCE9E8', teks: 'FFB3261E' },
      l: { isi: 'FFF5F6F5', teks: 'FF8A9491' }
    };

    const garis = (warna = 'FFBFC9C6') => ({
      top: { style: 'thin', color: { argb: warna } },
      left: { style: 'thin', color: { argb: warna } },
      bottom: { style: 'thin', color: { argb: warna } },
      right: { style: 'thin', color: { argb: warna } }
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Absensi Guru SMP ABBS';
    wb.created = new Date();

    const namaSheet = ('Rekap ' + periodeLabel.replace(/\s[–-]\s/, '-')).slice(0, 31);
    const ws = wb.addWorksheet(namaSheet, {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 }
      }
    });

    ws.columns = [
      { width: 5 },
      { width: 30 },
      ...Array.from({ length: jumlahHari }, () => ({ width: 6.5 })),
      ...Array.from({ length: 6 }, () => ({ width: 6.5 })),
      { width: 9 }
    ];

    ws.mergeCells(1, 1, 1, kolomAkhir);
    const selJudul = ws.getCell(1, 1);
    selJudul.value = 'REKAP ABSENSI GURU — SMP ABBS SURAKARTA';
    selJudul.font = { bold: true, size: 15, color: { argb: 'FF0A3B31' } };
    selJudul.alignment = { vertical: 'middle' };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, kolomAkhir);
    const selSub = ws.getCell(2, 1);
    selSub.value = `Periode: ${periodeLabel}   ·   Dicetak: ${new Date().toLocaleString('id-ID')}   ·   TOT = tepat waktu (≤ 06:50), Hadir = 06:51–07:00, Terlambat = setelah 07:00`;
    selSub.font = { italic: true, size: 9, color: { argb: 'FF5D6F6A' } };
    selSub.alignment = { vertical: 'middle' };
    ws.getRow(2).height = 18;

    const barisHeader = 3;
    const header = ['No', 'Guru'];
    for (const tgl of tanggal) {
      const bulan = BULAN_PENDEK[Number(tgl.slice(5, 7)) - 1];
      header.push(`${Number(tgl.slice(8))}\n${bulan}`);
    }
    header.push(...kolomKode, '% Hadir');

    header.forEach((isi, i) => {
      const sel = ws.getCell(barisHeader, i + 1);
      sel.value = isi;
      sel.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7A63' } };
      sel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      sel.border = garis('FF0A5C4B');
    });
    ws.getRow(barisHeader).height = 30;

    rekap.guru.forEach((g, i) => {
      const baris = barisHeader + 1 + i;

      const selNo = ws.getCell(baris, 1);
      selNo.value = i + 1;
      selNo.font = { size: 9, color: { argb: 'FF5D6F6A' } };
      selNo.alignment = { horizontal: 'center', vertical: 'middle' };
      selNo.border = garis();

      const selNama = ws.getCell(baris, 2);
      selNama.value = g.nama || '-';
      selNama.font = { size: 10 };
      selNama.alignment = { vertical: 'middle' };
      selNama.border = garis();

      tanggal.forEach((tgl, idx) => {
        const sel = ws.getCell(baris, kolomAwalHari + idx);
        const info = selTampil(g.id, tgl);
        const kode = kodeSel(g.id, tgl).k;

        sel.value = info.teks || '';
        sel.font = { size: 9, bold: kode === 'TOT' || kode === 'TL' };
        sel.alignment = { horizontal: 'center', vertical: 'middle' };
        sel.border = garis();

        const warna =
          kode === 'TOT' ? WARNA.tot :
          kode === 'TL' ? WARNA.tl :
          kode === 'H' ? WARNA.h :
          kode === 'S' ? WARNA.s :
          kode === 'I' ? WARNA.i :
          kode === 'A' ? WARNA.a :
          kode === 'L' ? WARNA.l : null;

        if (warna) {
          sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: warna.isi } };
          sel.font = { ...sel.font, color: { argb: warna.teks } };
        }
      });

      const t = hitungTotal(g.id);
      const nilaiTotal = [t.tot, t.tl, t.h, t.s, t.i, t.a, t.persen + '%'];
      nilaiTotal.forEach((nilai, j) => {
        const sel = ws.getCell(baris, kolomTotal + j);
        sel.value = nilai;
        sel.font = { size: 9, bold: true };
        sel.alignment = { horizontal: 'center', vertical: 'middle' };
        sel.border = garis();
      });

      if (t.persen >= 80) {
        ws.getCell(baris, kolomAkhir).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F6EE' } };
      } else if (t.persen < 60) {
        ws.getCell(baris, kolomAkhir).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE9E8' } };
      }

      ws.getRow(baris).height = 18;
    });

    const barisJumlah = barisHeader + rekap.guru.length + 1;
    ws.mergeCells(barisJumlah, 1, barisJumlah, 2);
    const selJumlah = ws.getCell(barisJumlah, 1);
    selJumlah.value = 'JUMLAH';
    selJumlah.font = { bold: true, size: 10 };
    selJumlah.alignment = { horizontal: 'center', vertical: 'middle' };

    for (let k = 1; k <= kolomAkhir; k++) {
      const sel = ws.getCell(barisJumlah, k);
      sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4F1' } };
      sel.border = garis('FF9FB3AD');
    }

    const totalKeseluruhan = rekap.guru.reduce(
      (akumulasi, g) => {
        const t = hitungTotal(g.id);
        return {
          tot: akumulasi.tot + t.tot, tl: akumulasi.tl + t.tl, h: akumulasi.h + t.h,
          s: akumulasi.s + t.s, i: akumulasi.i + t.i, a: akumulasi.a + t.a
        };
      },
      { tot: 0, tl: 0, h: 0, s: 0, i: 0, a: 0 }
    );

    [totalKeseluruhan.tot, totalKeseluruhan.tl, totalKeseluruhan.h,
     totalKeseluruhan.s, totalKeseluruhan.i, totalKeseluruhan.a].forEach((nilai, j) => {
      const sel = ws.getCell(barisJumlah, kolomTotal + j);
      sel.value = nilai;
      sel.font = { bold: true, size: 9 };
      sel.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    ws.getRow(barisJumlah).height = 20;

    const barisCatatan = barisJumlah + 2;
    ws.mergeCells(barisCatatan, 1, barisCatatan, Math.min(10, kolomAkhir));
    const selCatatan = ws.getCell(barisCatatan, 1);
    selCatatan.value =
      'Periode gaji: tanggal 21 bulan sebelumnya sampai tanggal 20 bulan ini. ' +
      'TOT = tepat waktu (≤ batas), TOT* = kebijakan manajemen unit, H = hadir dicatat admin, ' +
      'S = sakit, I = izin, A = alpa, L = libur. ' +
      'Sel berisi jam absen. Data diambil dari aplikasi Absensi Guru SMP ABBS.';
    selCatatan.font = { italic: true, size: 8.5, color: { argb: 'FF5D6F6A' } };
    selCatatan.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(barisCatatan).height = 24;

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const tautan = document.createElement('a');
    tautan.href = URL.createObjectURL(blob);
    tautan.download = `rekap-absensi-${rekap.periode?.mulai || 'periode'}.xlsx`;
    tautan.click();
    URL.revokeObjectURL(tautan.href);

    toast('File Excel diunduh.');
  } catch (err) {
    toast(err.message || 'Gagal membuat file Excel.');
  } finally {
    tombol.disabled = false;
    tombol.textContent = teksAsli;
  }
}

// ── self-check logika rekap ─────────────────────────────────────────────────
// Jalankan di browser: index.html?uji=1  (hasil di console)
function ujiLogika() {
  const asli = { ...rekap };
  const hasil = [];
  const cek = (nama, dapat, harus) =>
    hasil.push({ nama, lulus: JSON.stringify(dapat) === JSON.stringify(harus), dapat, harus });

  try {
    rekap.periode = periodeDariMulaiJs('2026-10-21');
    rekap.tanggal = tanggalAntara(rekap.periode.mulai, rekap.periode.selesai);
    rekap.hariIni = '2026-11-20';
    rekap.hariKerja = new Set([1, 2, 3, 4, 5, 6]);
    rekap.libur = new Set();
    rekap.peta = new Map([
      ['u1|2026-11-20', { status: 'hadir', tepat_waktu: true }],
      ['u2|2026-11-18', { status: 'hadir', tepat_waktu: false, terlambat: true }],
      ['u4|2026-11-17', { status: 'hadir', tepat_waktu: false, terlambat: false }],
      ['u3|2026-11-19', { status: 'izin' }]
    ]);

    cek('periode 21 Okt - 20 Nov = 31 hari', rekap.tanggal.length, 31);
    cek('tanggal pertama', rekap.tanggal[0], '2026-10-21');
    cek('tanggal terakhir', rekap.tanggal[30], '2026-11-20');
    cek('20 Nov 2026 = Jumat (5)', isoDow('2026-11-20'), 5);
    cek('1 Nov 2026 = Minggu (7)', isoDow('2026-11-01'), 7);
    cek('sel TOT', kodeSel('u1', '2026-11-20'), { k: 'TOT', c: 'k-tot' });
    cek('sel TL', kodeSel('u2', '2026-11-18'), { k: 'TL', c: 'k-tl' });
    cek('sel hadir biasa', kodeSel('u4', '2026-11-17'), { k: 'H', c: 'k-h' });
    cek('sel izin', kodeSel('u3', '2026-11-19'), { k: 'I', c: 'k-i' });
    cek('sel alpa (hari kerja lewat)', kodeSel('uX', '2026-11-02'), { k: 'A', c: 'k-a' });
    cek('sel minggu = libur', kodeSel('uX', '2026-11-08'), { k: 'L', c: 'k-l' });
    cek('sel hari ini belum absen = kosong', kodeSel('uX', '2026-11-20'), { k: '', c: 'k-kosong' });

    const t1 = hitungTotal('u1');
    cek('total TOT', [t1.tot, t1.tl, t1.a, t1.efektif, t1.persen], [1, 0, 26, 27, 4]);
    const tX = hitungTotal('uX');
    // hari ini (20 Nov) belum dihitung Alpa, tapi masuk penyebut %kehadiran
    cek('tanpa absen = semua alpa', [tX.a, tX.efektif, tX.persen], [26, 27, 0]);

    rekap.peta.set('u4|2026-11-17', { status: 'hadir', tepat_waktu: false, dicatat_oleh: 'admin' });
    cek('hadir manual = kode H', kodeSel('u4', '2026-11-17').k, 'H');
    const t4 = hitungTotal('u4');
    cek('hadir manual tidak masuk TOT', [t4.h, t4.tot, t4.persen], [1, 0, 4]);

    rekap.libur = new Set(['2026-11-20']);
    cek('libur menimpa status', kodeSel('u1', '2026-11-20').k, 'L');
    cek('libur mengurangi hari efektif', hitungTotal('uX').efektif, 26);

    rekap.libur = new Set();
    rekap.hariKerja = new Set([1, 2, 3, 4, 5]);
    cek('tanpa Sabtu', hitungTotal('uX').efektif, 23);
  } finally {
    Object.assign(rekap, asli);
  }

  const gagal = hasil.filter(h => !h.lulus);
  hasil.forEach(h => console[h.lulus ? 'log' : 'error']((h.lulus ? 'OK   ' : 'GAGAL') + ' ' + h.nama, h.lulus ? '' : h));
  console.log(`self-check: ${hasil.length - gagal.length}/${hasil.length} lulus`);
  return gagal.length === 0;
}

// -- panel pengaturan (admin) ------------------------------------------------
function bukaPengaturan() {
  if (!profil || profil.role !== 'admin') return;
  isiFormPengaturan();
  gambarLibur(rekap.liburDaftar || []);
  $('tirai-pengaturan').hidden = false;
}

function tutupPengaturan() {
  $('tirai-pengaturan').hidden = true;
}

// Kompres foto: sisi terpanjang 760 px, kualitas turun sampai �90 KB.
function fotoKompres(video, canvas) {
  const sisi = Math.max(video.videoWidth, video.videoHeight) || 760;
  const skala = Math.min(1, 760 / sisi);
  canvas.width = Math.round(video.videoWidth * skala);
  canvas.height = Math.round(video.videoHeight * skala);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  let kualitas = 0.6;
  let data = canvas.toDataURL('image/jpeg', kualitas);
  while (data.length > 120000 && kualitas > 0.32) {
    kualitas -= 0.08;
    data = canvas.toDataURL('image/jpeg', kualitas);
  }
  return data;
}

async function arsipkanPeriodeLalu() {
  if (modeDemo) return toast('Mode demo: arsip tidak dijalankan.');
  if (!confirm('Salin semua foto periode lalu ke Google Drive, lalu hapus fotonya dari Supabase?\nData absen (jam, status, jarak) tetap tersimpan.')) return;

  $('set-arsip-info').textContent = 'Mengarsipkan… (bisa 1-2 menit)';
  try {
    const hasil = await api('arsip_final', {});
    $('set-arsip-info').textContent =
      `Periode ${hasil.periode.label}: ${hasil.terarsip} foto disalin, ${hasil.dihapus} foto dibersihkan.`;
    toast(hasil.dihapus ? `${hasil.dihapus} foto diarsipkan ke Drive.` : 'Arsip periode lalu sudah rapi.');
  } catch (err) {
    $('set-arsip-info').textContent = '';
    toast(err.message);
  }
}

// Hentikan pemantauan GPS (dipakai setelah absen / keluar).
function hentikanLokasi() {
  if (pengamatLokasi != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(pengamatLokasi);
  }
  pengamatLokasi = null;
}
