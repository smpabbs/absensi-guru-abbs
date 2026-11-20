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
let absenHariIni = null;

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

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function urlFoto(path) {
  if (!path) return null;
  const { data } = await db.storage.from('absensi-foto').createSignedUrl(path, 600);
  return data?.signedUrl || null;
}

function tampilkan(view) {
  ['login', 'absen', 'rekap'].forEach(v => { $('view-' + v).hidden = v !== view; });
  $('topbar').hidden = view === 'login';
}

// ── start ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (location.search.includes('uji')) ujiLogika();
  pasangEvent();
  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseKey) {
    tampilkan('login');
    $('login-salah').hidden = false;
    $('login-salah').textContent = 'config.js belum diisi (supabaseUrl / supabaseKey).';
    return;
  }
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) await sesudahLogin(session.user);
  else tampilkan('login');
});

function pasangEvent() {
  $('form-login').addEventListener('submit', masuk);
  $('tombol-keluar').addEventListener('click', keluar);

  $('tombol-kamera').addEventListener('click', async () => {
    try {
      await aktifkanKamera();
    } catch (e) {
      toast('Kamera tidak bisa dibuka: ' + (e.message || 'izin ditolak'));
    }
  });

  $('tombol-absen').addEventListener('click', kirimAbsen);
  $('rekap-bulan').addEventListener('change', muatRekap);
  $('rekap-cari').addEventListener('input', gambarUlangTabel);
  $('rekap-csv').addEventListener('click', unduhCsv);
  $('rekap-cetak').addEventListener('click', () => window.print());
  $('tirai').addEventListener('click', (e) => { if (e.target.id === 'tirai') tutupModal(); });
  $('set-simpan').addEventListener('click', simpanPengaturan);
  $('set-lokasi-saya').addEventListener('click', () => ambilLokasiSekali($('set-lat'), $('set-lon'), $('set-info')));
  $('libur-tambah').addEventListener('click', tambahLibur);
}

// ── auth ────────────────────────────────────────────────────────────────────
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
    const { data: email, error } = await db.rpc('absensi_login_email', { p_username: username });
    if (error) throw new Error('Koneksi ke server gagal. Hubungi admin (' + error.message + ')');
    if (!email) throw new Error('Username atau kata sandi salah.');

    const { data, error: err } = await db.auth.signInWithPassword({ email, password });
    if (err) throw new Error('Username atau kata sandi salah.');

    await sesudahLogin(data.user);
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

async function sesudahLogin(user) {
  const { data: p, error } = await db.from('profiles')
    .select('id,nama,role,username,sekolah_id,status')
    .eq('id', user.id).single();

  if (error || !p) { await db.auth.signOut(); tampilkan('login'); toast('Profil tidak ditemukan.'); return; }
  if (!['guru', 'admin'].includes(p.role) || p.status !== 'aktif') {
    await db.auth.signOut();
    tampilkan('login');
    $('login-salah').hidden = false;
    $('login-salah').textContent = 'Akun ini bukan guru/admin aktif SMP ABBS.';
    return;
  }

  profil = p;
  $('siapa').textContent = p.nama || p.username || '';

  const { data: cfg } = await db.from('absensi_pengaturan').select('*').limit(1).maybeSingle();
  pengaturan = cfg;

  if (p.role === 'admin') {
    tampilkan('rekap');
    await muatRekap();
  } else {
    tampilkan('absen');
    await muatAbsen();
  }
}

// ── absen (guru) ────────────────────────────────────────────────────────────
async function muatAbsen() {
  const tgl = tanggalWIB();
  $('absen-halo').textContent = 'Assalamu\'alaikum, ' + (profil.nama || '').replace(/,.*$/, '');
  $('absen-tanggal').textContent = tanggalPanjang(tgl) + ' · ' + jamWIB() + ' WIB';

  if (!pengaturan) {
    $('info-pesan').textContent = 'Pengaturan absensi belum dibuat. Hubungi admin.';
    return;
  }
  $('info-tot').textContent = potongJam(pengaturan.batas_tot) + ' WIB';
  $('info-radius').textContent = pengaturan.radius_m + ' m';

  const { data: rec } = await db.from('absensi_guru')
    .select('tanggal,jam,status,tepat_waktu,jarak_m,foto_path')
    .eq('user_id', profil.id).eq('tanggal', tgl).maybeSingle();

  absenHariIni = rec || null;
  if (rec?.jam) tampilkanHasil(rec);
  else mulaiLokasi();

  await muatRiwayat();
}

function tampilkanHasil(rec) {
  hentikanKamera();
  $('kartu-kamera').hidden = true;
  $('hasil').hidden = false;
  const tot = rec.tepat_waktu;
  $('hasil-lencana').textContent = rec.status === 'hadir' ? (tot ? 'TOT · TEPAT WAKTU' : 'TL · TERLAMBAT')
    : rec.status.toUpperCase();
  $('hasil-lencana').className = 'lencana ' + (tot ? 'ok' : 'peringatan');
  $('hasil-jam').textContent = potongJam(rec.jam);
  $('hasil-sub').textContent = rec.jarak_m != null ? Math.round(rec.jarak_m) + ' m dari titik sekolah' : '';
  if (rec.foto_path) {
    urlFoto(rec.foto_path).then(u => {
      if (!u) return;
      $('hasil-foto').src = u;
      $('hasil-foto').hidden = false;
    });
  }
  $('info-pesan').textContent = 'Absen hari ini sudah tercatat.';
  $('info-pesan').className = 'pesan info';
}

function mulaiLokasi() {
  if (!navigator.geolocation) {
    $('info-pesan').textContent = 'Perangkat ini tidak mendukung GPS.';
    return;
  }
  navigator.geolocation.watchPosition(
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

async function aktifkanKamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false
  });
  const v = $('video');
  v.srcObject = stream;
  v.hidden = false;
  $('kamera-kosong').hidden = true;
  $('tombol-kamera').hidden = true;
  $('tombol-absen').hidden = false;
  $('tombol-absen').disabled = !posisi || !pengaturan ||
    haversine(posisi.lat, posisi.lon, pengaturan.lat, pengaturan.lon) > pengaturan.radius_m;
}

function hentikanKamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('video').hidden = true;
  $('kamera-kosong').hidden = false;
  $('tombol-kamera').hidden = false;
  $('tombol-absen').hidden = true;
}

async function kirimAbsen() {
  if (!posisi) return toast('Lokasi belum terbaca.');
  const tombol = $('tombol-absen');
  tombol.disabled = true;
  tombol.textContent = 'Mengirim…';

  try {
    const v = $('video'), c = $('canvas');
    if (!v.videoWidth) throw new Error('Kamera belum siap. Tunggu sebentar.');
    // perkecil ke lebar 1024 supaya unggahan ringan
    const skala = Math.min(1, 1024 / v.videoWidth);
    c.width = Math.round(v.videoWidth * skala);
    c.height = Math.round(v.videoHeight * skala);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);

    const dataUrl = c.toDataURL('image/jpeg', 0.72);
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${profil.id}/${tanggalWIB()}/${Date.now()}.jpg`;

    const { error: errUnggah } = await db.storage.from('absensi-foto')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (errUnggah) throw new Error('Gagal mengunggah foto: ' + errUnggah.message);

    const { data, error } = await db.rpc('absensi_absen', {
      p_lat: posisi.lat,
      p_lon: posisi.lon,
      p_akurasi: posisi.akurasi,
      p_foto_path: path
    });
    if (error) throw new Error('Gagal menyimpan absen: ' + error.message);

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

    tampilkanHasil({ tanggal: data.tanggal, jam: data.jam, status: 'hadir', tepat_waktu: data.tepat_waktu, jarak_m: data.jarak, foto_path: path });
    toast(data.tepat_waktu ? 'Absen tercatat — TOT (tepat waktu).' : 'Absen tercatat — terlambat.');
    await muatRiwayat();
  } catch (err) {
    toast(err.message);
    tombol.disabled = false;
    tombol.textContent = 'Absen Sekarang';
  }
}

async function muatRiwayat() {
  const { data, error } = await db.from('absensi_guru')
    .select('tanggal,jam,status,tepat_waktu,jarak_m')
    .eq('user_id', profil.id)
    .order('tanggal', { ascending: false })
    .limit(14);

  const tb = $('riwayat');
  if (error || !data?.length) {
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--teks-lembut)">Belum ada riwayat.</td></tr>';
    return;
  }
  tb.innerHTML = data.map(r => {
    const kode = r.status === 'hadir' ? (r.tepat_waktu ? 'TOT' : 'TL') : r.status.toUpperCase();
    const kls = r.status !== 'hadir' ? 'k-i' : (r.tepat_waktu ? 'k-tot' : 'k-tl');
    return `<tr>
      <td>${r.tanggal.split('-').reverse().join('/')}</td>
      <td>${potongJam(r.jam)}</td>
      <td><span class="k-${kls.replace('k-', '')}" style="padding:2px 8px;border-radius:6px">${kode}</span></td>
      <td>${r.jarak_m != null ? Math.round(r.jarak_m) + ' m' : '—'}</td>
    </tr>`;
  }).join('');
}

// ── rekap (admin) ───────────────────────────────────────────────────────────
async function muatRekap() {
  if (!profil || profil.role !== 'admin') return;
  const bulan = $('rekap-bulan').value || bulanIniWIB();
  $('rekap-bulan').value = bulan;
  $('rekap-bulan-label').textContent = bulanPanjang(bulan) + ' · ' + (profil.nama || '');
  rekap.bulan = bulan;
  rekap.hariIni = tanggalWIB();

  const [tahun, bln] = bulan.split('-').map(Number);
  const jumlahHari = new Date(tahun, bln, 0).getDate();
  const awal = `${bulan}-01`;
  const akhir = `${bulan}-${String(jumlahHari).padStart(2, '0')}`;

  if (pengaturan) {
    rekap.hariKerja = new Set(pengaturan.hari_kerja || [1, 2, 3, 4, 5, 6]);
    isiFormPengaturan();
  }

  const [guruRes, absenRes, liburRes] = await Promise.all([
    db.from('profiles').select('id,nama').eq('role', 'guru').eq('sekolah_id', profil.sekolah_id).order('nama'),
    db.from('absensi_guru').select('user_id,tanggal,jam,status,tepat_waktu,jarak_m,akurasi_m,foto_path,catatan,dicatat_oleh')
      .gte('tanggal', awal).lte('tanggal', akhir),
    db.from('absensi_libur').select('tanggal,keterangan').gte('tanggal', awal).lte('tanggal', akhir)
  ]);

  if (guruRes.error) { toast('Gagal memuat data guru: ' + guruRes.error.message); return; }

  rekap.guru = guruRes.data || [];
  rekap.peta = new Map((absenRes.data || []).map(r => [r.user_id + '|' + r.tanggal, r]));
  rekap.libur = new Set((liburRes.data || []).map(r => r.tanggal));

  gambarUlangTabel();
  gambarLibur(liburRes.data || []);
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
      const { k, c } = kodeSel(g.id, tgl);
      tr += `<td class="sel ${c}" data-uid="${g.id}" data-tgl="${tgl}">${k}</td>`;
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
  if (!modalAktif) return;
  const catatan = $('modal-catatan')?.value || null;
  const { data, error } = await db.rpc('absensi_set_status', {
    p_user_id: modalAktif.uid,
    p_tanggal: modalAktif.tgl,
    p_status: aksi === 'hapus' ? 'alpa' : aksi,
    p_catatan: catatan,
    p_hapus: aksi === 'hapus'
  });
  if (error) return toast('Gagal: ' + error.message);
  if (!data.ok) return toast(data.message || 'Gagal mengubah status.');
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
  if (!profil || profil.role !== 'admin') return;
  const hari = [...$('set-hari').querySelectorAll('input:checked')].map(c => Number(c.value));
  if (!hari.length) return toast('Pilih minimal satu hari kerja.');

  const isi = {
    lat: Number($('set-lat').value),
    lon: Number($('set-lon').value),
    radius_m: Math.round(Number($('set-radius').value)),
    batas_tot: $('set-tot').value,
    hari_kerja: hari,
    updated_at: new Date().toISOString()
  };
  if (!Number.isFinite(isi.lat) || !Number.isFinite(isi.lon)) return toast('Koordinat tidak valid.');
  if (!(isi.radius_m >= 10 && isi.radius_m <= 5000)) return toast('Radius harus 10–5000 meter.');

  const { error } = await db.from('absensi_pengaturan').update(isi).eq('id', true);
  if (error) return toast('Gagal menyimpan: ' + error.message);

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
      const { error } = await db.from('absensi_libur').delete().eq('tanggal', b.dataset.hapus);
      if (error) return toast('Gagal menghapus libur: ' + error.message);
      await muatRekap();
    });
  });
}

async function tambahLibur() {
  const tanggal = $('libur-tanggal').value;
  const keterangan = $('libur-ket').value.trim();
  if (!tanggal) return toast('Pilih tanggal libur.');
  const { error } = await db.from('absensi_libur').insert({ tanggal, keterangan: keterangan || null });
  if (error) return toast('Gagal menambah libur: ' + error.message);
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
