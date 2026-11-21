// Pratinjau rekap admin tanpa database: memalsukan sesi + respons Edge Function.
// Jalankan lewat Playwright MCP: browser_run_code_unsafe({ filename: 'tests/mock-ui.js' })
// (server lokal: python -m http.server 8080)

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const UID = '11111111-1111-1111-1111-111111111111';
  const SEK = '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2';

  const pengaturan = {
    id: true, sekolah_id: SEK, lat: -7.539134, lon: 110.805751,
    radius_m: 50, batas_tot: '06:50:00', hari_kerja: [1, 2, 3, 4, 5, 6]
  };

  const namaGuru = ['Adila Rahmah, M.Pd', 'Afriyan Moneter Pratama', 'Ahmad Bayu Abdullah, M.Pd',
    'Amien Nur Wicaksono, S.Ag', 'Anni Wijayanti, S.Pd', 'Arif Hidayat, M.Pd',
    'Asnia Novitasari AM, M.E', 'Binti Qoeroti, S.Pd., M.Si',
    'Charlieta Nova Putri Fedito, S.Kom', 'Danang Dwi Pambudi, S.Pd., Gr.',
    'Farida Nur Hidayati, S.Pd', 'Tri Wijayanti, M.Pd'];
  const guru = namaGuru.map((nama, i) => ({ id: 'g' + i, nama }));

  const rows = [];
  guru.forEach((g, gi) => {
    for (let d = 1; d <= 19; d++) {
      const tgl = `2026-11-${String(d).padStart(2, '0')}`;
      const dow = ((new Date(tgl + 'T00:00:00').getDay() + 6) % 7) + 1;
      if (dow === 7 || (d + gi) % 11 === 0) continue;
      if ((d + gi) % 7 === 0) {
        rows.push({ user_id: g.id, tanggal: tgl, jam: '00:00', status: d % 2 ? 'izin' : 'sakit',
          tepat_waktu: false, jarak_m: null, akurasi_m: null, foto_path: null,
          catatan: d % 2 ? 'acara keluarga' : 'surat dokter', dicatat_oleh: UID });
        continue;
      }
      const telat = (d + gi) % 5 === 0;
      rows.push({ user_id: g.id, tanggal: tgl, jam: telat ? '07:12' : '06:39', status: 'hadir',
        tepat_waktu: !telat, terlambat: telat, jarak_m: 18 + (d * gi) % 40, akurasi_m: 8 + d % 12,
        foto_path: null, catatan: null, dicatat_oleh: null });
    }
  });

  const sesi = {
    access_token: 'uji', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3000, refresh_token: 'uji',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'admin@local', app_metadata: {}, user_metadata: {}, created_at: '' }
  };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-' + REF + '-auth-token', JSON.stringify(sesi)]);

  await page.route('**/functions/v1/absen', async (route) => {
    const isi = JSON.parse(route.request().postData() || '{}');
    let jawab = { ok: true };
    if (isi.action === 'boot') {
      jawab = {
        profil: { id: UID, nama: 'Admin SMP ABBS Surakarta', username: 'admin.abbs', role: 'admin' },
        guruSekolah: false, adminSekolah: true, pengaturan,
        tanggal: '2026-11-19', jam: '07:10:00', hariIni: null
      };
    } else if (isi.action === 'rekap') {
      jawab = { guru, rows: rows.filter(r => r.tanggal.startsWith(isi.bulan || '2026-11')),
        libur: [{ tanggal: (isi.bulan || '2026-11') + '-05', keterangan: 'Libur contoh' }], pengaturan };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) });
  });

  await page.goto('http://localhost:8080/');
  await page.waitForFunction(() => document.querySelectorAll('#tabel-rekap tbody tr').length > 0, { timeout: 15000 });

  return await page.evaluate(() => ({
    baris: document.querySelectorAll('#tabel-rekap tbody tr').length,
    kartu: document.querySelectorAll('.hp-kartu').length,
    label: document.getElementById('rekap-bulan-label').textContent,
    ringkas: document.getElementById('rekap-ringkas').innerText.replace(/\n/g, ' | ')
  }));
}
