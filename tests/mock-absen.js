// Pratinjau halaman absen guru tanpa database (mock Edge Function).
// Jalankan lewat Playwright MCP: browser_run_code_unsafe({ filename: '...' })

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const UID = '22222222-2222-2222-2222-222222222222';
  const SEK = '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2';

  const pengaturan = {
    id: true, sekolah_id: SEK, lat: -7.539134, lon: 110.805751,
    radius_m: 50, batas_tot: '06:50:00', batas_masuk: '07:00:00', hari_kerja: [1, 2, 3, 4, 5, 6]
  };

  const boot = {
    profil: { id: UID, nama: 'Tri Wijayanti, M.Pd', username: 'tri.wijayanti', role: 'guru' },
    guruSekolah: true, adminSekolah: false, pengaturan,
    tanggal: '2026-11-20', jam: '06:38:12', hariIni: null,
    periode: {
      periode: { mulai: '2026-10-21', selesai: '2026-11-20', label: '21 Okt 2026 - 20 Nov 2026' },
      total: { tot: 12, terlambat: 3, normal: 2, hadir: 17, sakit: 1, izin: 2, alpa: 0 },
      efektif: 27, persen: 78
    }
  };

  // daftar semua hari dalam periode 21 Okt - 20 Nov 2026
  const hari = [];
  const selesai = new Date('2026-11-20T00:00:00Z');
  let urut = 0;
  for (let d = new Date('2026-10-21T00:00:00Z'); d <= selesai; d.setUTCDate(d.getUTCDate() + 1)) {
    const tgl = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    urut++;
    if (dow === 0) { hari.push({ tanggal: tgl, status: 'libur', jam: null }); continue; }
    if (urut % 9 === 0) { hari.push({ tanggal: tgl, status: 'belum', jam: null }); continue; }
    if (urut % 7 === 0) { hari.push({ tanggal: tgl, status: 'izin', jam: null, catatan: 'acara keluarga' }); continue; }
    if (urut % 11 === 0) { hari.push({ tanggal: tgl, status: 'sakit', jam: null }); continue; }
    const telat = urut % 5 === 0;
    const normal = !telat && urut % 4 === 0;
    hari.push({
      tanggal: tgl, status: 'hadir',
      jam: telat ? '07:12' : normal ? '06:55' : '06:41',
      tepat_waktu: !telat && !normal, terlambat: telat,
      jarak_m: 18 + (urut % 20)
    });
  }

  const ringkasan = { masuk: 0, tot: 0, hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, belum: 0, efektif: 0 };
  for (const h of hari) {
    const kerja = h.status !== 'libur';
    if (kerja) ringkasan.efektif++;
    if (h.status === 'hadir') {
      ringkasan.masuk++;
      if (h.tepat_waktu) ringkasan.tot++;
      else if (h.terlambat) ringkasan.terlambat++;
      else ringkasan.hadir++;
    } else if (h.status === 'izin') ringkasan.izin++;
    else if (h.status === 'sakit') ringkasan.sakit++;
    else if (h.status === 'alpa') ringkasan.alpa++;
    else if (h.status === 'belum') ringkasan.belum++;
  }
  ringkasan.persen = Math.round((ringkasan.masuk / ringkasan.efektif) * 100);

  const riwayat = {
    periode: { mulai: '2026-10-21', selesai: '2026-11-20', label: '21 Okt 2026 - 20 Nov 2026' },
    hariIni: '2026-11-20',
    hari,
    ringkasan
  };

  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -7.53915, longitude: 110.80577 });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-' + REF + '-auth-token', JSON.stringify({
    access_token: 'uji', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3000, refresh_token: 'uji',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'guru@local', app_metadata: {}, user_metadata: {}, created_at: '' }
  })]);

  await page.route('**/functions/v1/absen', async (route) => {
    const isi = JSON.parse(route.request().postData() || '{}');
    const jawab = isi.action === 'boot' ? boot
      : isi.action === 'riwayat' ? riwayat
      : isi.action === 'absen' ? { ok: true, tanggal: '2026-11-20', jam: '06:41', tepat_waktu: true, jarak: 3, foto_url: null }
      : isi.action === 'rekap_saya' ? boot.periode
      : { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) });
  });

  await page.goto('http://localhost:8080/');
  await page.waitForFunction(() => document.getElementById('absen-tanggal').textContent.length > 0, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'absen-guru.png', fullPage: true });

  return await page.evaluate(() => ({
    halo: document.getElementById('absen-halo').textContent,
    jarak: document.getElementById('info-jarak').textContent,
    pesan: document.getElementById('info-pesan').textContent,
    barisRiwayat: document.querySelectorAll('#riwayat .rb').length,
    ringkasRiwayat: document.getElementById('riwayat-ringkas').innerText.replace(/\n/g, ' | ')
  }));
}
