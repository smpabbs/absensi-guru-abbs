// Pratinjau rekap admin (mock Edge Function) dengan periode gaji 21 -> 20.
// Jalankan lewat Playwright MCP: browser_run_code_unsafe({ filename: 'tests/mock-ui.js' })

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const UID = '11111111-1111-1111-1111-111111111111';
  const SEK = '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2';

  const pengaturan = {
    id: true, sekolah_id: SEK, lat: -7.539134, lon: 110.805751,
    radius_m: 50, batas_tot: '06:50:00', batas_masuk: '07:00:00', hari_kerja: [1, 2, 3, 4, 5, 6]
  };

  const periode = { mulai: '2026-10-21', selesai: '2026-11-20', label: '21 Okt 2026 - 20 Nov 2026' };
  const tanggal = [];
  for (let d = new Date('2026-10-21T00:00:00Z'); d <= new Date('2026-11-20T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    tanggal.push(d.toISOString().slice(0, 10));
  }

  const namaGuru = ['Adila Rahmah, M.Pd', 'Afriyan Moneter Pratama', 'Ahmad Bayu Abdullah, M.Pd',
    'Amien Nur Wicaksono, S.Ag', 'Anni Wijayanti, S.Pd', 'Arif Hidayat, M.Pd',
    'Asnia Novitasari AM, M.E', 'Binti Qoeroti, S.Pd., M.Si',
    'Charlieta Nova Putri Fedito, S.Kom', 'Danang Dwi Pambudi, S.Pd., Gr.',
    'Farida Nur Hidayati, S.Pd', 'Tri Wijayanti, M.Pd'];
  const guru = namaGuru.map((nama, i) => ({ id: 'g' + i, nama }));

  const rows = [];
  guru.forEach((g, gi) => {
    tanggal.forEach((tgl, idx) => {
      const dow = ((new Date(tgl + 'T00:00:00').getDay() + 6) % 7) + 1;
      if (dow === 7 || (idx + gi) % 11 === 0) return;
      if ((idx + gi) % 7 === 0) {
        rows.push({ user_id: g.id, tanggal: tgl, jam: '00:00', status: idx % 2 ? 'izin' : 'sakit',
          tepat_waktu: false, terlambat: false, jarak_m: null, akurasi_m: null, foto_path: null,
          catatan: idx % 2 ? 'acara keluarga' : 'surat dokter', dicatat_oleh: UID });
        return;
      }
      const telat = (idx + gi) % 5 === 0;
      const normal = !telat && (idx + gi) % 4 === 0;
      rows.push({
        user_id: g.id, tanggal: tgl,
        jam: telat ? '07:12' : normal ? '06:55' : '06:39',
        status: 'hadir', tepat_waktu: !telat && !normal, terlambat: telat,
        jarak_m: 18 + (idx * gi) % 40, akurasi_m: 8 + idx % 12,
        foto_path: null, catatan: null, dicatat_oleh: null
      });
    });
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
        tanggal: '2026-11-20', jam: '07:10:00', hariIni: null, periode: null
      };
    } else if (isi.action === 'rekap') {
      if (isi.mulai && isi.mulai !== periode.mulai) {
        jawab = { guru, rows: [], libur: [], pengaturan, periode: { mulai: isi.mulai, selesai: '2026-12-20', label: '21 Nov 2026 - 20 Des 2026' } };
        return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) });
      }
      jawab = { guru, rows, libur: [{ tanggal: '2026-10-25', keterangan: 'Libur contoh' }], pengaturan, periode };
    } else if (isi.action === 'arsip_final') {
      jawab = { ok: true, periode: { label: '21 Okt 2026 - 20 Nov 2026' }, terarsip: 2, dihapus: 2 };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) });
  });

  await page.goto('http://localhost:8080/');
  await page.waitForFunction(() => document.querySelectorAll('#tabel-rekap tbody tr').length > 0, { timeout: 20000 });

  return await page.evaluate(() => ({
    baris: document.querySelectorAll('#tabel-rekap tbody tr').length,
    kartu: document.querySelectorAll('.hp-kartu').length,
    label: document.getElementById('rekap-bulan-label').textContent,
    pilihan: document.getElementById('rekap-bulan').options[0].textContent,
    kolom: document.querySelectorAll('#tabel-rekap thead th').length,
    ringkas: document.getElementById('rekap-ringkas').innerText.replace(/\n/g, ' | ')
  }));
}
