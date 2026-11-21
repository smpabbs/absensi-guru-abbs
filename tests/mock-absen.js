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
      periode: { mulai: '2026-11-21', selesai: '2026-12-20', label: '21 Nov 2026 - 20 Des 2026' },
      total: { tot: 12, terlambat: 3, hadir: 15, sakit: 1, izin: 2, alpa: 0 },
      efektif: 20, persen: 75
    }
  };

  const riwayat = {
    periode: { mulai: '2026-10-21', selesai: '2026-11-20', label: '21 Okt 2026 - 20 Nov 2026' },
    hariIni: '2026-11-20',
    riwayat: [
      { tanggal: '2026-11-19', jam: '06:41', status: 'hadir', tepat_waktu: true, jarak_m: 23 },
      { tanggal: '2026-11-18', jam: '07:03', status: 'hadir', tepat_waktu: false, jarak_m: 41 },
      { tanggal: '2026-11-17', jam: '06:35', status: 'hadir', tepat_waktu: true, jarak_m: 12 },
      { tanggal: '2026-11-16', jam: '00:00', status: 'izin', tepat_waktu: false, jarak_m: null }
    ]
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
    riwayat: document.getElementById('riwayat').innerText.replace(/\s+/g, ' ').slice(0, 100)
  }));
}
