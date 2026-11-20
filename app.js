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
let pengamatLokasi = null;
let absenHariIni = null;
let modeDemo = new URLSearchParams(location.search).get('demo') === '1';
let riwayatPeriode = null;
let periodeSekarang = null;

const rekap = {
  bulan: '',
  guru: [],
  peta: new Map(),
  libur: new Set(),
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

// isi dropdown bulan rekap (18 bulan terakhir, terbaru di atas)
function isiPilihanBulan() {
  const sel = $('rekap-bulan');
  if (sel.options.length) return;
  const [ty, tm] = bulanIniWIB().split('-').map(Number);
  let html = '';
  for (let i = 0; i < 18; i++) {
    const d = new Date(ty, tm - 1 - i, 1);
    const nilai = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    html += `<option value="${nilai}">${bulanPanjang(nilai)}</option>`;
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
async function urlFoto(path) {
  if (!path) return null;
  try {
    const { url } = await api('foto', { path });
    return url || null;
  } catch {
    return null;
  }
}

function tampilkan(view) {
  ['login', 'absen', 'rekap'].forEach(v => { $('view-' + v).hidden = v !== view; });
  $('topbar').hidden = view === 'login';
}

// ── mode demo: pratinjau rekap tanpa database (index.html?demo=1) ───────────
function mulaiDemo() {
  profil = { id: 'demo', nama: 'Admin SMP ABBS (demo)', role: 'admin', sekolah_id: 'demo', status: 'aktif' };
  pengaturan = { id: true, lat: -7.539134, lon: 110.805751, radius_m: 50, batas_tot: '06:50:00', hari_kerja: [1, 2, 3, 4, 5, 6] };

  $('siapa').textContent = 'Mode demo';
  $('demo-banner').hidden = false;

  const bulan = bulanIniWIB();
  rekap.bulan = bulan;
  rekap.hariIni = tanggalWIB();
  rekap.hariKerja = new Set(pengaturan.hari_kerja);
  rekap.libur = new Set([`${bulan}-05`]);
  rekap.guru = ['Adila Rahmah, M.Pd', 'Afriyan Moneter Pratama', 'Ahmad Bayu Abdullah, M.Pd',
    'Amien Nur Wicaksono, S.Ag', 'Anni Wijayanti, S.Pd', 'Arif Hidayat, M.Pd',
    'Asnia Novitasari AM, M.E', 'Binti Qoeroti, S.Pd., M.Si',
    'Charlieta Nova Putri Fedito, S.Kom', 'Danang Dwi Pambudi, S.Pd., Gr.',
    'Farida Nur Hidayati, S.Pd', 'Yona Puspa Ningtias, S.Pd., Gr.']
    .map((nama, i) => ({ id: 'd' + i, nama }));

  const peta = new Map();
  rekap.guru.forEach((g, gi) => {
    for (let d = 1; d <= 31; d++) {
      const tgl = `${bulan}-${String(d).padStart(2, '0')}`;
      if (tgl > rekap.hariIni) break;
      if (!rekap.hariKerja.has(isoDow(tgl)) || rekap.libur.has(tgl)) continue;
      if ((d + gi) % 11 === 0) continue;                      // dibiarkan alpa
      if ((d + gi) % 7 === 0) {
        peta.set(g.id + '|' + tgl, {
          status: d % 2 ? 'izin' : 'sakit', jam: '00:00:00', tepat_waktu: false,
          jarak_m: null, akurasi_m: null, foto_path: null,
          catatan: d % 2 ? 'acara keluarga' : 'surat dokter', dicatat_oleh: 'demo'
        });
        continue;
      }
      const telat = (d + gi) % 5 === 0;
      peta.set(g.id + '|' + tgl, {
        status: 'hadir', jam: telat ? '07:12:00' : `06:${String(30 + (d * 3) % 20).padStart(2, '0')}:00`,
        tepat_waktu: !telat, jarak_m: 18 + (d * gi) % 40, akurasi_m: 8 + d % 12,
        foto_path: null, catatan: null, dicatat_oleh: null
      });
    }
  });
  rekap.peta = peta;

  $('rekap-bulan').value = bulan;
  isiPilihanBulan();
  $('rekap-bulan').value = bulan;
  $('rekap-bulan-label').textContent = bulanPanjang(bulan) + ' · Mode demo';
  isiFormPengaturan();
  gambarUlangTabel();
  gambarLibur([{ tanggal: `${bulan}-05`, keterangan: 'Libur contoh' }]);
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
  $('rekap-csv').addEventListener('click', unduhCsv);
  $('rekap-cetak').addEventListener('click', () => window.print());
  $('tirai').addEventListener('click', (e) => { if (e.target.id === 'tirai') tutupModal(); });
  $('set-simpan').addEventListener('click', simpanPengaturan);
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
  hentikanKamera();
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
    isiPilihanBulan();
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
  $('info-radius').textContent = pengaturan.radius_m + ' m';

  renderPeriode(boot.periode);

  $('kartu-kamera').hidden = false;
  $('kartu-status').hidden = false;
  $('kartu-sukses').hidden = true;

  if (boot.hariIni?.jam) {
    tampilkanHasil(boot.hariIni);
  } else {
    mulaiLokasi();
    siapkanKamera();
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
  return rec.tepat_waktu ? 'Tepat waktu' : 'Terlambat';
}

function tampilkanHasil(rec, baruDikirim = false) {
  hentikanKamera();
  $('kartu-kamera').hidden = true;
  $('kartu-status').hidden = true;
  $('kartu-sukses').hidden = false;

  const status = labelStatus(rec);
  $('sukses-jam').textContent = potongJam(rec.jam) === '00:00' ? '—' : potongJam(rec.jam);
  $('sukses-status').textContent = status;
  $('sukses-status').className = rec.tepat_waktu ? 'ok' : rec.status === 'hadir' ? 'peringatan' : 'bahaya';
  $('kartu-sukses').classList.toggle('baru', baruDikirim);
}

function mulaiLokasi() {
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
  const jarak = haversine(posisi.lat, posisi.lon, pengaturan.lat, pengaturan.lon);
  const radius = pengaturan.radius_m;
  const dalam = jarak <= radius;

  $('info-jarak').textContent = Math.round(jarak) + ' m';
  $('info-akurasi').textContent = '±' + Math.round(posisi.akurasi) + ' m';

  const pesan = $('info-pesan');
  if (dalam) {
    pesan.textContent = 'Di dalam radius absen. Ambil foto lalu tekan Absen.';
    pesan.className = 'pesan info';
  } else {
    pesan.textContent = `Anda ${Math.round(jarak)} m dari titik sekolah, maksimal ${radius} m.`;
    pesan.className = 'pesan salah';
  }
  $('tombol-absen').disabled = !dalam || !posisi;
}

async function siapkanKamera() {
  const kotak = $('kamera-kosong');
  const status = $('kamera-status');
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Perangkat ini tidak mendukung kamera.';
    return;
  }

  kotak.hidden = false;
  kotak.textContent = 'Menunggu izin kamera…';
  status.textContent = 'Menunggu izin kamera…';

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    const v = $('video');
    v.srcObject = stream;
    v.hidden = false;
    kotak.hidden = true;
    status.textContent = 'Kamera siap. Wajah Anda terlihat?';
    $('tombol-absen').hidden = false;
    $('tombol-absen').disabled = !posisi || !pengaturan ||
      haversine(posisi.lat, posisi.lon, pengaturan.lat, pengaturan.lon) > pengaturan.radius_m;
  } catch (err) {
    // izin ditolak / kamera dipakai aplikasi lain
    stream = null;
    matikanVideo();
    kotak.hidden = false;
    kotak.innerHTML = 'Izin kamera belum aktif.<br>Muat ulang halaman untuk meminta izin lagi.';
    status.textContent = 'Kamera tidak aktif.';
    $('tombol-absen').hidden = true;
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
  const tombol = $('tombol-absen');
  tombol.disabled = true;
  tombol.textContent = 'Mengirim…';

  try {
    const v = $('video'), c = $('canvas');
    if (!v.videoWidth) throw new Error('Kamera belum siap. Tunggu sebentar.');
    // perkecil ke lebar 1024 supaya kiriman ringan
    const skala = Math.min(1, 1024 / v.videoWidth);
    c.width = Math.round(v.videoWidth * skala);
    c.height = Math.round(v.videoHeight * skala);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const foto = c.toDataURL('image/jpeg', 0.72);

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
  const tb = $('riwayat');
  let data;
  try {
    data = await api('riwayat', mulai ? { mulai } : {});
  } catch (err) {
    tb.innerHTML = `<tr><td colspan="4" style="color:var(--merah)">${err.message}</td></tr>`;
    return;
  }

  riwayatPeriode = data.periode;
  $('riwayat-periode').textContent = data.periode.label;
  $('riwayat-maju').disabled = !periodeSekarang || data.periode.mulai >= periodeSekarang;
  $('riwayat-mundur').disabled = false;

  if (!data.riwayat?.length) {
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--ink-lembut)">Belum ada absensi pada periode ini.</td></tr>';
    return;
  }
  tb.innerHTML = data.riwayat.map(r => {
    const kode = labelStatus(r);
    const kls = r.status !== 'hadir' ? 'k-i' : (r.tepat_waktu ? 'k-tot' : 'k-tl');
    return `<tr>
      <td>${r.tanggal.split('-').reverse().join('/')}</td>
      <td>${potongJam(r.jam) === '00:00' ? '—' : potongJam(r.jam)}</td>
      <td><span class="k-${kls.replace('k-', '')}" style="padding:3px 9px;border-radius:999px;font-size:12px">${kode}</span></td>
      <td>${r.jarak_m != null ? Math.round(r.jarak_m) + ' m' : '—'}</td>
    </tr>`;
  }).join('');
}

// ── rekap (admin) ───────────────────────────────────────────────────────────
async function muatRekap() {
  if (modeDemo) return;
  if (!profil || profil.role !== 'admin') return;
  const bulan = $('rekap-bulan').value || bulanIniWIB();
  $('rekap-bulan').value = bulan;
  $('rekap-bulan-label').textContent = bulanPanjang(bulan) + ' · ' + (profil.nama || '');
  rekap.bulan = bulan;
  rekap.hariIni = tanggalWIB();

  let data;
  try {
    data = await api('rekap', { bulan });
  } catch (err) {
    toast(err.message);
    return;
  }

  pengaturan = data.pengaturan || pengaturan;
  rekap.hariKerja = new Set(pengaturan?.hari_kerja || [1, 2, 3, 4, 5, 6]);
  rekap.guru = data.guru || [];
  rekap.peta = new Map((data.rows || []).map(r => [r.user_id + '|' + r.tanggal, r]));
  rekap.libur = new Set((data.libur || []).map(r => r.tanggal));

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
      if (rec.dicatat_oleh) return { k: 'H', c: 'k-h' };   // hadir dicatat admin, bukan TOT
      return rec.tepat_waktu ? { k: 'TOT', c: 'k-tot' } : { k: 'TL', c: 'k-tl' };
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
  if (k === 'TOT' || k === 'TL') {
    const jam = potongJam(rec?.jam);
    return { teks: jam || k, kelas: c, judul: `${hari}: ${labelStatus(rec)} pukul ${jam}` };
  }
  if (k === 'H') return { teks: 'H', kelas: c, judul: `${hari}: hadir dicatat admin` };
  if (!rec) return { teks: k, kelas: c, judul: `${hari}: ${k === 'A' ? 'alpa (tidak ada absen)' : k}` };
  return { teks: k, kelas: c, judul: `${hari}: ${labelStatus(rec)}` };
}

function hitungTotal(uid, jumlahHari) {
  const t = { tot: 0, tl: 0, h: 0, s: 0, i: 0, a: 0, efektif: 0 };
  for (let d = 1; d <= jumlahHari; d++) {
    const tgl = `${rekap.bulan}-${String(d).padStart(2, '0')}`;
    const dow = isoDow(tgl);
    const kerja = rekap.hariKerja.has(dow) && !rekap.libur.has(tgl);
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
  const [tahun, bln] = rekap.bulan.split('-').map(Number);
  const jumlahHari = new Date(tahun, bln, 0).getDate();
  const cari = $('rekap-cari').value.trim().toLowerCase();

  const thead = document.querySelector('#tabel-rekap thead');
  const tbody = document.querySelector('#tabel-rekap tbody');

  let h = '<tr><th class="nama">Guru</th>';
  for (let d = 1; d <= jumlahHari; d++) {
    const tgl = `${rekap.bulan}-${String(d).padStart(2, '0')}`;
    h += `<th title="${HARI[isoDow(tgl) - 1]}">${d}</th>`;
  }
  h += '<th class="total">TOT</th><th class="total">TL</th><th class="total">H</th><th class="total">S</th>'
     + '<th class="total">I</th><th class="total">A</th><th class="total">%</th></tr>';
  thead.innerHTML = h;

  let rows = '', ringkas = { guru: 0, hadir: 0, tot: 0, tl: 0 };
  const hariIniBulanIni = rekap.hariIni.startsWith(rekap.bulan) ? rekap.hariIni : null;

  for (const g of rekap.guru) {
    if (cari && !(g.nama || '').toLowerCase().includes(cari)) continue;
    ringkas.guru++;

    let tr = `<tr><td class="nama" title="${g.nama || ''}">${g.nama || '-'}</td>`;
    for (let d = 1; d <= jumlahHari; d++) {
      const tgl = `${rekap.bulan}-${String(d).padStart(2, '0')}`;
      const sel = selTampil(g.id, tgl);
      tr += `<td class="sel ${sel.kelas}" data-uid="${g.id}" data-tgl="${tgl}" title="${sel.judul}">${sel.teks}</td>`;
    }
    const t = hitungTotal(g.id, jumlahHari);
    tr += `<td class="total">${t.tot}</td><td class="total">${t.tl}</td><td class="total">${t.h}</td><td class="total">${t.s}</td>`
        + `<td class="total">${t.i}</td><td class="total">${t.a}</td><td class="total">${t.persen}%</td></tr>`;
    rows += tr;

    const rec = hariIniBulanIni ? rekap.peta.get(g.id + '|' + hariIniBulanIni) : null;
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
    <div class="chip">Total TOT bulan ini <b>${rekap.guru.reduce((n, g) => n + hitungTotal(g.id, jumlahHari).tot, 0)}</b></div>`;

  gambarKartuHp(jumlahHari, cari);
}

// Versi HP: satu kartu per guru berisi kalender mini (tabel terlalu lebar di layar kecil)
function gambarKartuHp(jumlahHari, cari) {
  const box = $('rekap-hp');
  if (!box) return;
  if (!window.matchMedia('(max-width: 760px)').matches) { box.innerHTML = ''; return; }

  let html = '';
  const offset = isoDow(`${rekap.bulan}-01`) - 1;

  for (const g of rekap.guru) {
    if (cari && !(g.nama || '').toLowerCase().includes(cari)) continue;

    const t = hitungTotal(g.id, jumlahHari);
    const kelas = t.persen >= 80 ? 'ok' : t.persen >= 50 ? 'peringatan' : 'bahaya';

    let kal = '<span class="hp-hari kosong"></span>'.repeat(offset);
    for (let d = 1; d <= jumlahHari; d++) {
      const tgl = `${rekap.bulan}-${String(d).padStart(2, '0')}`;
      const sel = selTampil(g.id, tgl);
      const jam = sel.kelas === 'k-tot' || sel.kelas === 'k-tl' ? sel.teks : '';
      kal += `<button class="hp-hari ${sel.kelas}" data-uid="${g.id}" data-tgl="${tgl}" title="${sel.judul}">
        <span class="hp-tgl">${d}</span>${jam ? `<span class="hp-jam">${jam}</span>` : ''}
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
  const statusTeks = !rec ? ''
    : rec.status !== 'hadir' ? rec.status
    : rec.dicatat_oleh ? 'Hadir (dicatat admin)'
    : rec.tepat_waktu ? 'Tepat waktu (TOT)' : 'Terlambat';
  modalAktif = { uid, tgl };

  $('modal').innerHTML = `
    <h2>${guru?.nama || '-'}</h2>
    <div class="meta">${tanggalPanjang(tgl)} · ${kode || 'belum absen'}</div>
    ${rec?.foto_path ? '<div id="modal-foto" style="color:var(--teks-lembut);font-size:13px">memuat foto…</div>' : ''}
    ${rec ? `<div class="status-baris"><span>Jam</span><span class="nilai">${jamTeks}</span></div>
      <div class="status-baris"><span>Status</span><span class="nilai">${statusTeks}</span></div>
      <div class="status-baris"><span>Jarak</span><span class="nilai">${rec.jarak_m != null ? Math.round(rec.jarak_m) + ' m' : '—'}</span></div>
      <div class="status-baris"><span>Akurasi</span><span class="nilai">${rec.akurasi_m != null ? '±' + Math.round(rec.akurasi_m) + ' m' : '—'}</span></div>` : '<p style="font-size:14px;color:var(--teks-lembut)">Belum ada data absensi pada tanggal ini.</p>'}

    <div class="bidang" style="margin-top:14px">
      <label for="modal-catatan">Catatan (opsional)</label>
      <input type="text" id="modal-catatan" value="${(rec?.catatan || '').replace(/"/g, '&quot;')}" placeholder="mis. surat dokter">
    </div>
    <div class="aksi">
      <button class="tombol kecil" data-set="hadir">Hadir</button>
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

  if (rec?.foto_path) {
    urlFoto(rec.foto_path).then(u => {
      const box = $('modal-foto');
      if (!box) return;
      box.outerHTML = u ? `<img src="${u}" alt="Foto absen">` : '<p style="font-size:13px;color:var(--teks-lembut)">Foto tidak tersedia.</p>';
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
  try {
    await api('set_status', {
      user_id: modalAktif.uid,
      tanggal: modalAktif.tgl,
      status: aksi === 'hapus' ? 'alpa' : aksi,
      catatan,
      hapus: aksi === 'hapus'
    });
  } catch (err) {
    return toast(err.message);
  }
  tutupModal();
  toast('Status diperbarui.');
  await muatRekap();
}

// ── pengaturan & libur ──────────────────────────────────────────────────────
function isiFormPengaturan() {
  if (!pengaturan) return;
  $('set-lat').value = pengaturan.lat;
  $('set-lon').value = pengaturan.lon;
  $('set-radius').value = pengaturan.radius_m;
  $('set-tot').value = potongJam(pengaturan.batas_tot);

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
    hari_kerja: hari
  };
  if (!Number.isFinite(isi.lat) || !Number.isFinite(isi.lon)) return toast('Koordinat tidak valid.');
  if (!(isi.radius_m >= 10 && isi.radius_m <= 5000)) return toast('Radius harus 10–5000 meter.');

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

// ── export CSV ──────────────────────────────────────────────────────────────
function unduhCsv() {
  const [tahun, bln] = rekap.bulan.split('-').map(Number);
  const jumlahHari = new Date(tahun, bln, 0).getDate();
  const baris = [];

  const kepala = ['No', 'Guru'];
  for (let d = 1; d <= jumlahHari; d++) kepala.push(String(d));
  kepala.push('TOT', 'TL', 'H', 'S', 'I', 'A', '%Hadir');
  baris.push(kepala);

  rekap.guru.forEach((g, i) => {
    const row = [i + 1, g.nama || ''];
    for (let d = 1; d <= jumlahHari; d++) {
      row.push(kodeSel(g.id, `${rekap.bulan}-${String(d).padStart(2, '0')}`).k);
    }
    const t = hitungTotal(g.id, jumlahHari);
    row.push(t.tot, t.tl, t.h, t.s, t.i, t.a, t.persen);
    baris.push(row);
  });

  const csv = '\ufeff' + baris.map(r =>
    r.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(',')
  ).join('\r\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `rekap-absensi-${rekap.bulan}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV diunduh.');
}

// ── self-check logika rekap ─────────────────────────────────────────────────
// Jalankan di browser: index.html?uji=1  (hasil di console)
function ujiLogika() {
  const asli = { ...rekap };
  const hasil = [];
  const cek = (nama, dapat, harus) =>
    hasil.push({ nama, lulus: JSON.stringify(dapat) === JSON.stringify(harus), dapat, harus });

  try {
    rekap.bulan = '2026-11';
    rekap.hariIni = '2026-11-20';
    rekap.hariKerja = new Set([1, 2, 3, 4, 5, 6]);
    rekap.libur = new Set();
    rekap.peta = new Map([
      ['u1|2026-11-20', { status: 'hadir', tepat_waktu: true }],
      ['u2|2026-11-18', { status: 'hadir', tepat_waktu: false }],
      ['u3|2026-11-19', { status: 'izin' }]
    ]);

    cek('20 Nov 2026 = Jumat (5)', isoDow('2026-11-20'), 5);
    cek('1 Nov 2026 = Minggu (7)', isoDow('2026-11-01'), 7);
    cek('sel TOT', kodeSel('u1', '2026-11-20'), { k: 'TOT', c: 'k-tot' });
    cek('sel TL', kodeSel('u2', '2026-11-18'), { k: 'TL', c: 'k-tl' });
    cek('sel izin', kodeSel('u3', '2026-11-19'), { k: 'I', c: 'k-i' });
    cek('sel alpa (hari kerja lewat)', kodeSel('uX', '2026-11-02'), { k: 'A', c: 'k-a' });
    cek('sel minggu = libur', kodeSel('uX', '2026-11-08'), { k: 'L', c: 'k-l' });
    cek('sel hari ini belum absen = kosong', kodeSel('uX', '2026-11-20'), { k: '', c: 'k-kosong' });

    const t1 = hitungTotal('u1', 30);
    cek('total TOT', [t1.tot, t1.tl, t1.a, t1.efektif, t1.persen], [1, 0, 16, 17, 6]);
    const tX = hitungTotal('uX', 30);
    // hari ini (20 Nov) belum dihitung Alpa, tapi masuk penyebut %kehadiran
    cek('tanpa absen = semua alpa', [tX.a, tX.efektif, tX.persen], [16, 17, 0]);

    rekap.peta.set('u4|2026-11-17', { status: 'hadir', tepat_waktu: false, dicatat_oleh: 'admin' });
    cek('hadir manual = kode H', kodeSel('u4', '2026-11-17').k, 'H');
    const t4 = hitungTotal('u4', 30);
    cek('hadir manual tidak masuk TOT', [t4.h, t4.tot, t4.persen], [1, 0, 6]);

    rekap.libur = new Set(['2026-11-20']);
    cek('libur menimpa status', kodeSel('u1', '2026-11-20').k, 'L');
    cek('libur mengurangi hari efektif', hitungTotal('uX', 30).efektif, 16);

    rekap.libur = new Set();
    rekap.hariKerja = new Set([1, 2, 3, 4, 5]);
    cek('tanpa Sabtu', hitungTotal('uX', 30).efektif, 15);
  } finally {
    Object.assign(rekap, asli);
  }

  const gagal = hasil.filter(h => !h.lulus);
  hasil.forEach(h => console[h.lulus ? 'log' : 'error']((h.lulus ? 'OK   ' : 'GAGAL') + ' ' + h.nama, h.lulus ? '' : h));
  console.log(`self-check: ${hasil.length - gagal.length}/${hasil.length} lulus`);
  return gagal.length === 0;
}
