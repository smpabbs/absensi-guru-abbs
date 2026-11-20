// Pratinjau halaman absen guru (tanpa database).
// Jalankan lewat Playwright MCP: browser_run_code_unsafe({ filename: '...' })

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const UID = '22222222-2222-2222-2222-222222222222';
  const SEK = '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2';

  const profil = { id: UID, nama: 'Tri Wijayanti, M.Pd', role: 'guru', username: 'tri.wijayanti', sekolah_id: SEK, status: 'aktif' };
  const cfg = { id: true, sekolah_id: SEK, lat: -7.539134, lon: 110.805751, radius_m: 50, batas_tot: '06:50:00', hari_kerja: [1, 2, 3, 4, 5, 6], updated_at: '' };

  const riwayat = [
    { tanggal: '2026-11-19', jam: '06:41:00', status: 'hadir', tepat_waktu: true, jarak_m: 23, foto_path: null },
    { tanggal: '2026-11-18', jam: '07:03:00', status: 'hadir', tepat_waktu: false, jarak_m: 41, foto_path: null },
    { tanggal: '2026-11-17', jam: '06:35:00', status: 'hadir', tepat_waktu: true, jarak_m: 12, foto_path: null },
    { tanggal: '2026-11-16', jam: '00:00:00', status: 'izin', tepat_waktu: false, jarak_m: null, foto_path: null }
  ];

  const sesi = {
    access_token: 'uji', token_type: 'bearer', expires_in: 31536000,
    expires_at: Math.floor(Date.now() / 1000) + 31536000, refresh_token: 'uji',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'guru@lms.local', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  };

  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -7.53915, longitude: 110.80577 });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-' + REF + '-auth-token', JSON.stringify(sesi)]);

  let adaHariIni = true;
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const jalur = req.url().split('/rest/v1/')[1]?.split('?')[0] || '';
    const tunggal = (req.headers()['accept'] || '').includes('pgrst.object');
    let body = [];
    if (jalur === 'profiles') body = profil;
    else if (jalur === 'absensi_pengaturan') body = cfg;
    else if (jalur === 'absensi_guru') {
      const adaFilterTanggal = req.url().includes('tanggal=eq.');
      const hariIni = { tanggal: '2026-11-20', jam: '06:38:00', status: 'hadir', tepat_waktu: true, jarak_m: 19, foto_path: null };
      body = adaFilterTanggal ? (adaHariIni ? [hariIni] : []) : [hariIni, ...riwayat];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('http://localhost:8080/');
  await page.waitForTimeout(1500);
  const sudah = {
    lencana: await page.locator('#hasil-lencana').innerText(),
    jam: await page.locator('#hasil-jam').innerText(),
    sub: await page.locator('#hasil-sub').innerText()
  };
  await page.screenshot({ path: 'absen-sudah.png', fullPage: true });

  adaHariIni = false;
  await page.reload();
  await page.waitForTimeout(2000);
  const belum = {
    jarak: await page.locator('#info-jarak').innerText(),
    akurasi: await page.locator('#info-akurasi').innerText(),
    pesan: await page.locator('#info-pesan').innerText(),
    tombolKamera: await page.locator('#tombol-kamera').isVisible()
  };
  await page.screenshot({ path: 'absen-belum.png', fullPage: true });

  return { sudah, belum };
}

