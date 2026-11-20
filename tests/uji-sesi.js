// Uji UI dengan sesi LMS asli (token sementara dari /.uji-sesi.json di server lokal).
// Hanya untuk pengujian; file token dihapus setelah selesai.

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const kunci = 'sb-' + REF + '-auth-token';

  const pasang = async (jenis) => {
    const token = await page.evaluate(async (j) => {
      const r = await fetch('/.uji-sesi.json?t=' + Date.now());
      const o = await r.json();
      return o[j];
    }, jenis);

    const sesi = {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3000,
      refresh_token: 'uji',
      user: { id: 'uji', aud: 'authenticated', role: 'authenticated', email: 'uji@local', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [kunci, JSON.stringify(sesi)]);
    await page.goto('http://localhost:8080/');
    await page.waitForTimeout(1200);
  };

  // ── guru ────────────────────────────────────────────────────────────────
  await page.goto('http://localhost:8080/');
  await pasang('guru');
  await page.waitForFunction(() => document.getElementById('absen-tanggal').textContent.length > 0, { timeout: 20000 });
  const guru = await page.evaluate(() => ({
    loginTersembunyi: document.getElementById('view-login').hidden,
    absenTampil: !document.getElementById('view-absen').hidden,
    halo: document.getElementById('absen-halo').textContent,
    tanggal: document.getElementById('absen-tanggal').textContent,
    tot: document.getElementById('info-tot').textContent,
    radius: document.getElementById('info-radius').textContent,
    pesan: document.getElementById('info-pesan').textContent,
    riwayat: document.getElementById('riwayat').innerText.replace(/\s+/g, ' ').slice(0, 120)
  }));
  await page.screenshot({ path: 'uji-guru.png', fullPage: true });

  // ── admin ───────────────────────────────────────────────────────────────
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:8080/');
  await pasang('admin');
  await page.waitForFunction(() => document.querySelectorAll('#tabel-rekap tbody tr').length > 0, { timeout: 20000 });
  const admin = await page.evaluate(() => ({
    rekapTampil: !document.getElementById('view-rekap').hidden,
    label: document.getElementById('rekap-bulan-label').textContent,
    baris: document.querySelectorAll('#tabel-rekap tbody tr').length,
    ringkas: document.getElementById('rekap-ringkas').innerText.replace(/\n/g, ' | '),
    radiusForm: document.getElementById('set-radius').value,
    hariCentang: [...document.querySelectorAll('#set-hari input:checked')].map((c) => c.value).join(',')
  }));
  await page.screenshot({ path: 'uji-admin.png', fullPage: true });

  return { guru, admin };
}
