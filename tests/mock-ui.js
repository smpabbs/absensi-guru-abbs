// Pratinjau UI tanpa database: memalsukan sesi + respons Supabase.
// Dipakai untuk cek tampilan sebelum migration dijalankan.
// Jalankan lewat Playwright MCP: browser_run_code_unsafe({ filename: 'tests/mock-ui.js' })
// (server lokal: python -m http.server 8080)

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const UID = '11111111-1111-1111-1111-111111111111';
  const SEK = '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2';

  const admin = { id: UID, nama: 'Admin SMP ABBS Surakarta', role: 'admin', username: 'admin.abbs', sekolah_id: SEK, status: 'aktif' };
  const cfg = { id: true, sekolah_id: SEK, lat: -7.539134, lon: 110.805751, radius_m: 50, batas_tot: '06:50:00', hari_kerja: [1, 2, 3, 4, 5, 6], updated_at: '' };

  const namaGuru = ['Adila Rahmah, M.Pd', 'Afriyan Moneter Pratama', 'Ahmad Bayu Abdullah, M.Pd', 'Amien Nur Wicaksono, S.Ag',
    'Anni Wijayanti, S.Pd', 'Arif Hidayat, M.Pd', 'Asnia Novitasari AM, M.E', 'Binti Qoeroti, S.Pd., M.Si',
    'Charlieta Nova Putri Fedito, S.Kom', 'Danang Dwi Pambudi, S.Pd., Gr.', 'Farida Nur Hidayati, S.Pd', 'Tri Wijayanti, M.Pd'];
  const guru = namaGuru.map((nama, i) => ({ id: 'g' + i, nama }));

  const rows = [];
  guru.forEach((g, gi) => {
    for (let d = 1; d <= 19; d++) {
      const tgl = `2026-11-${String(d).padStart(2, '0')}`;
      const dow = ((new Date(tgl + 'T00:00:00').getDay() + 6) % 7) + 1;
      if (dow === 7) continue;
      if ((d + gi) % 11 === 0) continue;                     // alpa
      if ((d + gi) % 7 === 0) {
        rows.push({ user_id: g.id, tanggal: tgl, jam: '00:00:00', status: (d % 2 ? 'izin' : 'sakit'), tepat_waktu: false, jarak_m: null, akurasi_m: null, foto_path: null, catatan: d % 2 ? 'acara keluarga' : 'surat dokter', dicatat_oleh: UID });
        continue;
      }
      const telat = (d + gi) % 5 === 0;
      rows.push({
        user_id: g.id, tanggal: tgl, jam: telat ? '07:12:00' : '06:3' + (d % 6 ? 9 : 1) + ':00',
        status: 'hadir', tepat_waktu: !telat, jarak_m: 18 + ((d * gi) % 40), akurasi_m: 8 + (d % 12),
        foto_path: null, catatan: null, dicatat_oleh: null
      });
    }
  });

  const session = {
    access_token: 'uji', token_type: 'bearer', expires_in: 31536000,
    expires_at: Math.floor(Date.now() / 1000) + 31536000, refresh_token: 'uji',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'admin@lms.local', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  };

  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-' + REF + '-auth-token', JSON.stringify(session)]);

  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const jalur = req.url().split('/rest/v1/')[1]?.split('?')[0] || '';
    const tunggal = (req.headers()['accept'] || '').includes('pgrst.object');
    let body = [];
    if (jalur === 'profiles') body = tunggal ? admin : guru;
    else if (jalur === 'absensi_pengaturan') body = cfg;
    else if (jalur === 'absensi_guru') body = rows;
    else if (jalur === 'absensi_libur') body = [{ tanggal: '2026-11-05', keterangan: 'Libur Maulid' }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('http://localhost:8080/');
  await page.waitForTimeout(1500);

  return {
    url: page.url(),
    barisGuru: await page.locator('#tabel-rekap tbody tr').count(),
    judulBulan: await page.locator('#rekap-bulan-label').innerText(),
    ringkas: await page.locator('#rekap-ringkas').innerText()
  };
}
