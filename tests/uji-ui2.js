// Lanjutan uji UI: riwayat guru, modal sel admin, simpan pengaturan.

async (page) => {
  const REF = 'drlsnhnqxkcgcuskswwx';
  const kunci = 'sb-' + REF + '-auth-token';

  const masukSebagai = async (jenis) => {
    const token = await page.evaluate(async (j) => {
      const r = await fetch('/.uji-sesi.json?t=' + Date.now());
      const o = await r.json();
      return o[j];
    }, jenis);
    const sesi = {
      access_token: token, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3000, refresh_token: 'uji',
      user: { id: 'uji', aud: 'authenticated', role: 'authenticated', email: 'uji@local', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [kunci, JSON.stringify(sesi)]);
    await page.goto('http://localhost:8080/');
  };

  // guru: riwayat
  await page.goto('http://localhost:8080/');
  await masukSebagai('guru');
  await page.waitForFunction(() => !document.getElementById('riwayat').innerText.includes('Memuat'), { timeout: 20000 });
  const riwayat = await page.evaluate(() => document.getElementById('riwayat').innerText.replace(/\s+/g, ' '));

  // admin: modal + simpan pengaturan
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:8080/');
  await masukSebagai('admin');
  await page.waitForFunction(() => document.querySelectorAll('#tabel-rekap tbody tr').length > 0, { timeout: 20000 });

  await page.click('#tabel-rekap tbody tr:nth-child(2) td.sel:nth-child(4)');
  await page.waitForTimeout(600);
  const modal = await page.evaluate(() => ({
    tampil: !document.getElementById('tirai').hidden,
    judul: document.querySelector('#modal h2')?.textContent || '',
    meta: document.querySelector('#modal .meta')?.textContent || ''
  }));
  await page.click('#modal-tutup');

  await page.click('#pengaturan-box > summary');
  await page.waitForTimeout(300);
  await page.click('#set-simpan');
  await page.waitForTimeout(2000);
  const simpan = await page.evaluate(() => ({
    toast: document.getElementById('toast').textContent,
    radius: document.getElementById('set-radius').value
  }));

  return { riwayat, modal, simpan };
}
