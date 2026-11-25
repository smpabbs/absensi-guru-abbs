// Edge Function "absen" — project abbs-chat-belajar (lthyqvxpiykqfaqrumcx)
//
// Login tetap di LMS (drlsnhnqxkcgcuskswwx). Token LMS tidak berlaku di project ini,
// jadi setiap permintaan diverifikasi ke LMS lebih dulu (/auth/v1/user), baru
// data presensi ditulis/dibaca dengan service role ke schema `absensi`.
//
// Deploy:
//   supabase functions deploy absen --project-ref lthyqvxpiykqfaqrumcx --no-verify-jwt
//   supabase secrets set LMS_ANON_KEY=... --project-ref lthyqvxpiykqfaqrumcx

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const LMS_URL = Deno.env.get("LMS_URL") ?? "https://drlsnhnqxkcgcuskswwx.supabase.co";
const LMS_KEY = Deno.env.get("LMS_ANON_KEY") ?? "sb_publishable_nN04gESpLOjSg7KQObRfCA_6UjsRK99"; // publishable key LMS (memang publik)
const BUCKET = "absensi-foto";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const jawab = (isi: unknown, status = 200) =>
  new Response(JSON.stringify(isi), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

const galat = (pesan: string, status = 200, kode = "GALAT") =>
  jawab({ ok: false, code: kode, message: pesan }, status);

// ── util ────────────────────────────────────────────────────────────────────
function wib(d = new Date()) {
  const tanggal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const jam = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(d);
  return { tanggal, jam };
}

function jarakMeter(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const isoDow = (tgl: string) => {
  const d = new Date(tgl + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
};

const potongJam = (j: string | null) => (j ? j.slice(0, 5) : null);

async function profilDariToken(token: string) {
  const h = { apikey: LMS_KEY, Authorization: `Bearer ${token}` };
  const r = await fetch(`${LMS_URL}/auth/v1/user`, { headers: h });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;

  const p = await fetch(
    `${LMS_URL}/rest/v1/profiles?select=id,nama,role,username,sekolah_id,status&id=eq.${u.id}`,
    { headers: h }
  );
  if (!p.ok) return null;
  const arr = await p.json();
  return arr?.[0] ?? null;
}

async function daftarGuru(token: string, sekolahId: string) {
  // hanya guru berstatus aktif yang bisa login/absen; guru nonaktif tidak ditampilkan
  const r = await fetch(
    `${LMS_URL}/rest/v1/profiles?select=id,nama,username&role=eq.guru&status=eq.aktif&sekolah_id=eq.${sekolahId}&order=nama`,
    { headers: { apikey: LMS_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  return await r.json();
}

async function ambilPengaturan() {
  const { data } = await admin.from("absen_pengaturan").select("*").eq("id", true).maybeSingle();
  return data;
}

// Periode penggajian: tanggal 21 bulan lalu s.d. tanggal 20 bulan ini.
function periodeGaji(tanggal: string) {
  const [y, m, d] = tanggal.split("-").map(Number);
  const geser = (delta: number) => {
    const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 };
  };
  const awal = d >= 21 ? { y, m } : geser(-1);
  const akhir = d >= 21 ? geser(1) : { y, m };
  const p2 = (n: number) => String(n).padStart(2, "0");
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const tulis = (t: { y: number; m: number }, hari: number) =>
    `${hari} ${BULAN[t.m - 1]} ${t.y}`;

  return {
    mulai: `${awal.y}-${p2(awal.m)}-21`,
    selesai: `${akhir.y}-${p2(akhir.m)}-20`,
    label: `${tulis(awal, 21)} – ${tulis(akhir, 20)}`
  };
}

// Periode yang sama, tapi titik awalnya ditentukan (dipakai untuk melihat periode lalu).
function periodeDariMulai(mulai: string) {
  const [y, m] = mulai.split("-").map(Number);
  const akhir = new Date(Date.UTC(y, m, 1)); // bulan berikutnya
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const p2 = (n: number) => String(n).padStart(2, "0");
  const selesai = `${akhir.getUTCFullYear()}-${p2(akhir.getUTCMonth() + 1)}-20`;
  return {
    mulai,
    selesai,
    label: `21 ${BULAN[m - 1]} ${y} – 20 ${BULAN[akhir.getUTCMonth()]} ${akhir.getUTCFullYear()}`
  };
}

async function ringkasanPeriode(userId: string, pengaturan: { hari_kerja: number[] }) {
  const { tanggal } = wib();
  const periode = periodeGaji(tanggal);

  const { data: rows } = await admin.from("absen_presensi")
    .select("tanggal,status,tepat_waktu,terlambat,kebijakan")
    .eq("user_id", userId)
    .gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);

  const total = { tot: 0, terlambat: 0, normal: 0, hadir: 0, sakit: 0, izin: 0, alpa: 0 };
  for (const r of rows ?? []) {
    if (r.status === "hadir") {
      total.hadir++;
      if (r.tepat_waktu) total.tot++;
      else if (r.terlambat) total.terlambat++;
      else total.normal++;
    } else if (r.status === "sakit") total.sakit++;
    else if (r.status === "izin") total.izin++;
    else if (r.status === "alpa") total.alpa++;
  }

  // hari kerja efektif sampai hari ini, dikurangi hari libur
  const { data: libur } = await admin.from("absen_libur")
    .select("tanggal").gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);
  const setLibur = new Set((libur ?? []).map((l) => l.tanggal));

  const batas = tanggal < periode.selesai ? tanggal : periode.selesai;
  let efektif = 0;
  const akhir = new Date(batas + "T00:00:00Z");
  for (let d = new Date(periode.mulai + "T00:00:00Z"); d <= akhir; d.setUTCDate(d.getUTCDate() + 1)) {
    const tgl = d.toISOString().slice(0, 10);
    if (pengaturan.hari_kerja.includes(isoDow(tgl)) && !setLibur.has(tgl)) efektif++;
  }

  return {
    periode,
    total,
    efektif,
    persen: efektif ? Math.round((total.hadir / efektif) * 100) : 0
  };
}

async function urlFoto(path: string) {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

// ── Google Drive (arsip) ────────────────────────────────────────────────────
const GDRIVE_FOLDER = Deno.env.get("GDRIVE_FOLDER_ID") ?? "";
let tokenDriveCache: { token: string; exp: number } | null = null;

async function tokenDrive() {
  if (tokenDriveCache && Date.now() < tokenDriveCache.exp) return tokenDriveCache.token;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GDRIVE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GDRIVE_CLIENT_SECRET") ?? "",
      refresh_token: Deno.env.get("GDRIVE_REFRESH_TOKEN") ?? "",
      grant_type: "refresh_token"
    })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Gagal mengambil token Google: " + JSON.stringify(j).slice(0, 200));

  tokenDriveCache = { token: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
  return tokenDriveCache.token;
}

const folderCache = new Map<string, string>();

async function folderDrive(periode: { mulai: string; selesai: string }) {
  const nama = `${periode.mulai} sd ${periode.selesai}`;
  if (folderCache.has(nama)) return folderCache.get(nama)!;

  const token = await tokenDrive();
  const q = encodeURIComponent(
    `name='${nama}' and '${GDRIVE_FOLDER}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const cari = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const hasilCari = await cari.json();
  if (hasilCari.files?.length) {
    folderCache.set(nama, hasilCari.files[0].id);
    return hasilCari.files[0].id as string;
  }

  const buat = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: nama, mimeType: "application/vnd.google-apps.folder", parents: [GDRIVE_FOLDER] })
  });
  const hasilBuat = await buat.json();
  if (!hasilBuat.id) throw new Error("Gagal membuat folder Drive: " + JSON.stringify(hasilBuat).slice(0, 200));

  folderCache.set(nama, hasilBuat.id);
  return hasilBuat.id as string;
}

async function unggahDrive(nama: string, folderId: string, bytes: Uint8Array) {
  const token = await tokenDrive();
  const boundary = "----absen" + crypto.randomUUID();
  const enc = new TextEncoder();
  const kepala = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: nama, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const ekor = enc.encode(`\r\n--${boundary}--`);

  const isi = new Uint8Array(kepala.length + bytes.length + ekor.length);
  isi.set(kepala, 0);
  isi.set(bytes, kepala.length);
  isi.set(ekor, kepala.length + bytes.length);

  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: isi
    }
  );
  const j = await r.json();
  if (!j.id) throw new Error("Gagal mengunggah ke Drive: " + JSON.stringify(j).slice(0, 200));
  return j.id as string;
}

async function unduhDrive(id: string) {
  const token = await tokenDrive();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}

const namaFileDrive = (r: { tanggal: string; nama?: string | null; jam: string }) =>
  `${r.tanggal}_${(r.nama ?? "guru").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}_${String(r.jam).slice(0, 5).replace(":", "")}.jpg`;

async function arsipkanBatch(batas = 60, periode?: { mulai: string; selesai: string }, budgetMs = 90000) {
  const mulai = Date.now();
  let q = admin.from("absen_presensi")
    .select("id,tanggal,jam,user_id,nama,foto_path")
    .not("foto_path", "is", null)
    .is("arsip_drive_id", null)
    .order("tanggal", { ascending: true })
    .limit(batas);
  if (periode) q = q.gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);

  const { data: rows } = await q;
  let terarsip = 0, gagal = 0, berhenti = false;

  for (const r of rows ?? []) {
    // jangan sampai melewati batas waktu Edge Function (±150 detik)
    if (Date.now() - mulai > budgetMs) { berhenti = true; break; }

    try {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(r.foto_path as string);
      if (error || !blob) { gagal++; continue; }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const folder = await folderDrive(periodeGaji(r.tanggal as string));
      const idDrive = await unggahDrive(namaFileDrive(r as any), folder, bytes);

      const { error: errUpdate } = await admin.from("absen_presensi")
        .update({ arsip_drive_id: idDrive, arsip_at: new Date().toISOString() })
        .eq("id", r.id);
      if (errUpdate) gagal++; else terarsip++;
    } catch (e) {
      console.error("arsip gagal", r.id, e);
      gagal++;
    }
  }

  return { terarsip, gagal, dibaca: rows?.length ?? 0, berhenti };
}

function periodeTerakhirSelesai(tanggal: string) {
  const d = new Date(tanggal + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return periodeGaji(d.toISOString().slice(0, 10));
}

// ── handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return galat("Gunakan POST.", 405);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const aksi = String(body.action ?? "");
  const { tanggal, jam } = wib();

  // Pemanggilan terjadwal (cron) untuk membersihkan foto lama — tanpa akun pengguna.
  const rahasiaCron = Deno.env.get("CRON_SECRET") ?? "";
  const aksiCron = ["bersihkan_foto", "arsip_harian", "arsip_final"];
  const cronOk = aksiCron.includes(aksi) && !!rahasiaCron &&
    req.headers.get("x-cron-secret") === rahasiaCron;

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  let profil: any = null;
  let adminSekolah = false;
  let guruSekolah = false;

  if (!cronOk) {
    if (!token) return galat("Sesi habis, silakan login ulang.", 401, "UNAUTH");
    profil = await profilDariToken(token);
    if (!profil || profil.status !== "aktif") return galat("Akun tidak aktif di LMS.", 401, "UNAUTH");
  }

  const pengaturan = await ambilPengaturan();
  if (!pengaturan) return galat("Pengaturan absensi belum dibuat di database.", 500, "KONFIG");

  if (!cronOk && profil) {
    adminSekolah = profil.role === "admin" &&
      (profil.sekolah_id === pengaturan.sekolah_id || profil.sekolah_id === null);
    guruSekolah = profil.role === "guru" && profil.sekolah_id === pengaturan.sekolah_id;
  }

  try {
    switch (aksi) {
      // ── data awal setelah login ───────────────────────────────────────────
      case "boot": {
        if (!guruSekolah && !adminSekolah) return galat("Akun ini tidak berhak memakai absensi ini.", 403, "AKSES");
        let hariIni = null;
        if (guruSekolah) {
          const { data } = await admin.from("absen_presensi")
            .select("tanggal,jam,status,tepat_waktu,terlambat,jarak_m,foto_path")
            .eq("user_id", profil.id).eq("tanggal", tanggal).maybeSingle();
          if (data) {
            hariIni = {
              ...data,
              jam: potongJam(data.jam),
              foto_url: data.foto_path ? await urlFoto(data.foto_path) : null
            };
          }
        }
        return jawab({
          profil: { id: profil.id, nama: profil.nama, username: profil.username, role: profil.role },
          guruSekolah, adminSekolah, pengaturan, tanggal, jam, hariIni,
          periode: guruSekolah ? await ringkasanPeriode(profil.id, pengaturan) : null
        });
      }

      // ── absen mandiri (guru) ──────────────────────────────────────────────
      case "absen": {
        if (!guruSekolah) return galat("Akun admin hanya untuk rekap.", 403, "AKUN");

        if (!pengaturan.hari_kerja.includes(isoDow(tanggal))) {
          return galat("Hari ini bukan hari kerja.", 200, "LIBUR");
        }
        const { data: libur } = await admin.from("absen_libur")
          .select("tanggal").eq("tanggal", tanggal).maybeSingle();
        if (libur) return galat("Hari ini tercatat libur.", 200, "LIBUR");

        const lat = Number(body.lat), lon = Number(body.lon), akurasi = Number(body.akurasi);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return galat("Lokasi tidak terbaca. Aktifkan GPS lalu coba lagi.", 200, "LOKASI");
        }

        const jarak = jarakMeter(lat, lon, pengaturan.lat, pengaturan.lon);
        if (jarak > pengaturan.radius_m) {
          return jawab({
            ok: false, code: "RADIUS",
            jarak: Math.round(jarak), radius_m: pengaturan.radius_m,
            message: `Anda ${Math.round(jarak)} m dari titik sekolah. Maksimal ${pengaturan.radius_m} m.`
          });
        }

        const { data: sudah } = await admin.from("absen_presensi")
          .select("jam,tepat_waktu,terlambat,jarak_m,foto_path")
          .eq("user_id", profil.id).eq("tanggal", tanggal).maybeSingle();
        if (sudah) {
          return jawab({
            ok: false, code: "SUDAH",
            jam: potongJam(sudah.jam), tepat_waktu: sudah.tepat_waktu, terlambat: sudah.terlambat,
            jarak: sudah.jarak_m ? Math.round(sudah.jarak_m) : null,
            foto_path: sudah.foto_path,
            message: `Anda sudah absen hari ini pukul ${potongJam(sudah.jam)}.`
          });
        }

        // foto
        let fotoPath: string | null = null;
        const b64 = String(body.foto ?? "");
        if (b64) {
          const bersih = b64.includes(",") ? b64.split(",")[1] : b64;
          if (bersih.length > 4_000_000) return galat("Foto terlalu besar.", 200, "FOTO");
          const biner = Uint8Array.from(atob(bersih), (c) => c.charCodeAt(0));
          fotoPath = `${profil.id}/${tanggal}/${Date.now()}.jpg`;
          const { error: eh } = await admin.storage.from(BUCKET)
            .upload(fotoPath, biner, { contentType: "image/jpeg", upsert: false });
          if (eh) fotoPath = null;
        }

        // Kebijakan manajemen unit: username tertentu selalu dihitung TOT.
        const pengecualian = (pengaturan.pengecualian_tot ?? []) as string[];
        const kenaKebijakan = pengecualian.includes(String(profil.username ?? ""));

        const tepatWaktu = kenaKebijakan ? true : jam <= pengaturan.batas_tot;
        const terlambat = kenaKebijakan ? false : jam > pengaturan.batas_masuk;
        const baris = {
          user_id: profil.id,
          sekolah_id: pengaturan.sekolah_id,
          nama: profil.nama,
          tanggal,
          jam,
          status: "hadir",
          tepat_waktu: tepatWaktu,
          terlambat,
          kebijakan: kenaKebijakan,
          lat, lon,
          akurasi_m: Number.isFinite(akurasi) ? akurasi : null,
          jarak_m: jarak,
          foto_path: fotoPath
        };

        const { error } = await admin.from("absen_presensi").insert(baris);
        if (error) {
          if (String(error.code) === "23505") return galat("Anda sudah absen hari ini.", 200, "SUDAH");
          return galat("Gagal menyimpan absen: " + error.message, 500);
        }

        return jawab({
          ok: true, tanggal, jam: potongJam(jam), tepat_waktu: tepatWaktu, terlambat,
          batas_tot: potongJam(pengaturan.batas_tot), batas_masuk: potongJam(pengaturan.batas_masuk),
          jarak: Math.round(jarak), radius_m: pengaturan.radius_m, nama: profil.nama,
          foto_url: fotoPath ? await urlFoto(fotoPath) : null
        });
      }

      // ── riwayat guru (per periode gaji 21 → 20) ───────────────────────────
      case "riwayat": {
        if (profil.role !== "guru") return galat("Hanya untuk guru.", 403, "AKSES");

        const minta = String(body.mulai ?? "");
        const periode = /^\d{4}-\d{2}-21$/.test(minta)
          ? periodeDariMulai(minta)
          : periodeGaji(tanggal);

        const { data: rows, error } = await admin.from("absen_presensi")
          .select("tanggal,jam,status,tepat_waktu,terlambat,kebijakan,jarak_m,catatan")
          .eq("user_id", profil.id)
          .gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);
        if (error) return galat("Gagal memuat riwayat: " + error.message, 500);

        const { data: libur } = await admin.from("absen_libur")
          .select("tanggal").gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);

        const peta = new Map((rows ?? []).map((r) => [r.tanggal, r]));
        const setLibur = new Set((libur ?? []).map((l) => l.tanggal));
        const kerja = new Set(pengaturan.hari_kerja);

        const ringkasan = { tot: 0, hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, belum: 0, efektif: 0 };
        const hari: Record<string, unknown>[] = [];

        for (
          let d = new Date(periode.mulai + "T00:00:00Z");
          d <= new Date(periode.selesai + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1)
        ) {
          const tgl = d.toISOString().slice(0, 10);
          const dow = isoDow(tgl);
          const rec = peta.get(tgl);
          const liburHari = setLibur.has(tgl) || !kerja.has(dow);

          let status: string;
          if (liburHari) status = "libur";
          else if (rec) status = rec.status;
          else if (tgl > tanggal) status = "akan";
          else status = "belum";

          if (!liburHari && tgl <= tanggal) ringkasan.efektif++;

          if (status === "hadir") {
            if (rec?.tepat_waktu) ringkasan.tot++;
            else if (rec?.terlambat) ringkasan.terlambat++;
            else ringkasan.hadir++;
          } else if (status === "izin") ringkasan.izin++;
          else if (status === "sakit") ringkasan.sakit++;
          else if (status === "alpa") ringkasan.alpa++;
          else if (status === "belum") ringkasan.belum++;

          hari.push({
            tanggal: tgl,
            status,
            jam: rec ? potongJam(rec.jam) : null,
            tepat_waktu: rec?.tepat_waktu ?? false,
            terlambat: rec?.terlambat ?? false,
            jarak_m: rec?.jarak_m ?? null,
            catatan: rec?.catatan ?? null
          });
        }

        const masuk = ringkasan.tot + ringkasan.hadir + ringkasan.terlambat;
        return jawab({
          periode,
          hariIni: tanggal,
          hari,
          ringkasan: {
            ...ringkasan,
            masuk,
            persen: ringkasan.efektif ? Math.round((masuk / ringkasan.efektif) * 100) : 0
          }
        });
      }

      // ── ringkasan periode gaji milik sendiri ──────────────────────────────
      case "rekap_saya": {
        if (!guruSekolah) return galat("Hanya untuk guru.", 403, "AKSES");
        return jawab(await ringkasanPeriode(profil.id, pengaturan));
      }

      // ── rekap bulanan (admin) ─────────────────────────────────────────────
      case "rekap": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");

        // Periode gaji: tanggal 21 -> tanggal 20 bulan berikutnya.
        const minta = String(body.mulai ?? "");
        const periode = /^\d{4}-\d{2}-21$/.test(minta)
          ? periodeDariMulai(minta)
          : periodeGaji(tanggal);
        const awal = periode.mulai;
        const akhir = periode.selesai;

        const guru = await daftarGuru(token, pengaturan.sekolah_id);
        const { data: rows, error } = await admin.from("absen_presensi")
          .select("user_id,nama,tanggal,jam,status,tepat_waktu,terlambat,kebijakan,jarak_m,akurasi_m,foto_path,foto_dihapus,arsip_drive_id,catatan,dicatat_oleh,diubah_at")
          .eq("sekolah_id", pengaturan.sekolah_id)
          .gte("tanggal", awal).lte("tanggal", akhir);
        if (error) return galat("Gagal memuat rekap: " + error.message, 500);

        // guru yang sudah nonaktif tetap muncul bila punya catatan di bulan itu (riwayat)
        const sudahAda = new Set(guru.map((g: { id: string }) => g.id));
        for (const r of rows ?? []) {
          if (!sudahAda.has(r.user_id)) {
            guru.push({ id: r.user_id, nama: r.nama ?? "(nonaktif)" });
            sudahAda.add(r.user_id);
          }
        }
        guru.sort((a: { nama?: string }, b: { nama?: string }) =>
          String(a.nama ?? "").localeCompare(String(b.nama ?? ""), "id"));

        const { data: libur } = await admin.from("absen_libur")
          .select("tanggal,keterangan").gte("tanggal", awal).lte("tanggal", akhir);

        return jawab({ guru, rows: rows ?? [], libur: libur ?? [], pengaturan, periode });
      }

      // ── koreksi status (admin) ────────────────────────────────────────────
      case "set_status": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const uid = String(body.user_id ?? "");
        const tgl = String(body.tanggal ?? "");
        const status = String(body.status ?? "");
        const catatan = body.catatan ? String(body.catatan) : null;
        const jamInput = String(body.jam ?? "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(uid) || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
          return galat("Data tidak lengkap.", 200, "DATA");
        }
        if (jamInput && !/^\d{2}:\d{2}$/.test(jamInput)) {
          return galat("Jam tidak valid (HH:MM).", 200, "DATA");
        }

        if (body.hapus) {
          const { error } = await admin.from("absen_presensi").delete()
            .eq("user_id", uid).eq("tanggal", tgl);
          if (error) return galat("Gagal menghapus: " + error.message, 500);
          return jawab({ ok: true, hapus: true });
        }

        if (!["hadir", "izin", "sakit", "alpa"].includes(status)) {
          return galat("Status tidak dikenal.", 200, "DATA");
        }

        const { data: ada } = await admin.from("absen_presensi")
          .select("foto_path,dicatat_oleh").eq("user_id", uid).eq("tanggal", tgl).maybeSingle();

        const baris: Record<string, unknown> = {
          user_id: uid,
          sekolah_id: pengaturan.sekolah_id,
          tanggal: tgl,
          status,
          catatan,
          dicatat_oleh: ada?.foto_path ? (ada.dicatat_oleh ?? null) : profil.id,
          diubah_oleh: profil.id,
          diubah_at: new Date().toISOString()
        };

        const pengecualian = (pengaturan.pengecualian_tot ?? []) as string[];
        // username target diambil dari LMS agar konsisten dengan daftar kebijakan
        const guruLms = await daftarGuru(token, pengaturan.sekolah_id);
        const akunTarget = (guruLms as { id: string; username?: string }[])
          .find((g) => g.id === uid)?.username ?? "";
        const kenaKebijakan = status === "hadir" && pengecualian.includes(akunTarget);

        if (!ada) {
          baris.jam = jamInput ? `${jamInput}:00` : "00:00:00";
          baris.tepat_waktu = false;
          baris.terlambat = false;
        }

        // admin mengoreksi jam kehadiran: status & warna mengikuti jam baru
        if (jamInput) {
          baris.jam = `${jamInput}:00`;
          baris.tepat_waktu = jamInput <= potongJam(pengaturan.batas_tot);
          baris.terlambat = jamInput > potongJam(pengaturan.batas_masuk);
          if (status !== "hadir") baris.tepat_waktu = false;
        }

        baris.kebijakan = kenaKebijakan;
        if (kenaKebijakan) {
          baris.tepat_waktu = true;
          baris.terlambat = false;
        }

        const { error } = await admin.from("absen_presensi").upsert(baris, { onConflict: "user_id,tanggal" });
        if (error) return galat("Gagal menyimpan status: " + error.message, 500);
        return jawab({ ok: true });
      }

      // ── pengaturan (admin) ────────────────────────────────────────────────
      case "simpan_pengaturan": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const radius = Number(body.radius_m);
        const lat = Number(body.lat), lon = Number(body.lon);
        const batas = String(body.batas_tot ?? "");
        const masuk = String(body.batas_masuk ?? "");
        const simpanFoto = Number(body.simpan_foto_hari ?? pengaturan.simpan_foto_hari ?? 60);
        const pengecualian = Array.isArray(body.pengecualian_tot)
          ? body.pengecualian_tot.map((u: unknown) => String(u).trim().toLowerCase())
              .filter((u: string) => /^[a-z0-9._-]{2,60}$/.test(u)).slice(0, 50)
          : (pengaturan.pengecualian_tot ?? []);
        const hari = Array.isArray(body.hari_kerja) ? body.hari_kerja.map(Number) : [];

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return galat("Koordinat tidak valid.", 200, "DATA");
        if (!(radius >= 10 && radius <= 5000)) return galat("Radius harus 10-5000 meter.", 200, "DATA");
        if (!/^\d{2}:\d{2}$/.test(batas) || !/^\d{2}:\d{2}$/.test(masuk)) {
          return galat("Jam TOT / jam masuk tidak valid.", 200, "DATA");
        }
        if (masuk <= batas) return galat("Jam masuk harus setelah batas TOT.", 200, "DATA");
        if (!hari.length || hari.some((h) => !(h >= 1 && h <= 7))) return galat("Hari kerja tidak valid.", 200, "DATA");
        if (!(simpanFoto >= 0 && simpanFoto <= 3650)) return galat("Batas simpan foto 0-3650 hari.", 200, "DATA");

        const { error } = await admin.from("absen_pengaturan").update({
          lat, lon, radius_m: Math.round(radius), batas_tot: batas, batas_masuk: masuk,
          simpan_foto_hari: Math.round(simpanFoto), pengecualian_tot: pengecualian,
          hari_kerja: hari, updated_at: new Date().toISOString()
        }).eq("id", true);
        if (error) return galat("Gagal menyimpan pengaturan: " + error.message, 500);
        return jawab({ ok: true });
      }

      // ── bersihkan foto lama (admin atau cron) ──────────────────────────────
      case "bersihkan_foto": {
        if (!cronOk && !adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");

        const hari = Number(body.hari ?? pengaturan.simpan_foto_hari ?? 60);
        if (!(hari >= 1 && hari <= 3650)) return galat("Batas simpan foto 1-3650 hari.", 200, "DATA");

        const potong = new Date(Date.now() - hari * 86400000);
        const batasTgl = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
        }).format(potong);

        let total = 0;
        for (let putaran = 0; putaran < 25; putaran++) {
          const { data: rows, error } = await admin.from("absen_presensi")
            .select("id,foto_path")
            .not("foto_path", "is", null)
            .lt("tanggal", batasTgl)
            .limit(200);
          if (error) return galat("Gagal membaca data: " + error.message, 500);
          if (!rows?.length) break;

          const paths = rows.map((r) => r.foto_path).filter(Boolean) as string[];
          if (paths.length) await admin.storage.from(BUCKET).remove(paths);
          await admin.from("absen_presensi")
            .update({ foto_path: null, foto_dihapus: true })
            .in("id", rows.map((r) => r.id));

          total += rows.length;
          if (rows.length < 200) break;
        }

        return jawab({ ok: true, dihapus: total, batas: batasTgl, simpan_foto_hari: hari });
      }

      // ── isi hadir (kebijakan) untuk hari kerja yang terlewat ─────────────
      case "isi_kebijakan": {
        if (!cronOk && !adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");

        const daftar = (pengaturan.pengecualian_tot ?? []) as string[];
        if (!daftar.length) return jawab({ ok: true, diisi: 0, pesan: "Daftar pengecualian kosong." });

        const minta = String(body.mulai ?? "");
        const periode = /^\d{4}-\d{2}-21$/.test(minta)
          ? periodeDariMulai(minta)
          : periodeGaji(tanggal);

        const guru = await daftarGuru(token, pengaturan.sekolah_id) as { id: string; nama: string; username?: string }[];
        const target = guru.filter((g) => daftar.includes(String(g.username ?? "")));
        if (!target.length) return jawab({ ok: true, diisi: 0, pesan: "Tidak ada akun yang cocok." });

        const { data: libur } = await admin.from("absen_libur")
          .select("tanggal").gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);
        const setLibur = new Set((libur ?? []).map((l) => l.tanggal));
        const kerja = new Set(pengaturan.hari_kerja);

        const { data: ada } = await admin.from("absen_presensi")
          .select("user_id,tanggal")
          .in("user_id", target.map((t) => t.id))
          .gte("tanggal", periode.mulai).lte("tanggal", periode.selesai);
        const sudah = new Set((ada ?? []).map((r) => `${r.user_id}|${r.tanggal}`));

        const kemarin = new Date(tanggal + "T00:00:00Z");
        kemarin.setUTCDate(kemarin.getUTCDate() - 1);
        const batas = kemarin.toISOString().slice(0, 10);

        const baris: Record<string, unknown>[] = [];
        for (const g of target) {
          for (let d = new Date(periode.mulai + "T00:00:00Z");
               d <= new Date(Math.min(new Date(periode.selesai + "T00:00:00Z").getTime(), new Date(batas + "T00:00:00Z").getTime()));
               d.setUTCDate(d.getUTCDate() + 1)) {
            const tgl = d.toISOString().slice(0, 10);
            if (!kerja.has(isoDow(tgl)) || setLibur.has(tgl)) continue;
            if (sudah.has(`${g.id}|${tgl}`)) continue;
            baris.push({
              user_id: g.id,
              sekolah_id: pengaturan.sekolah_id,
              nama: g.nama,
              tanggal: tgl,
              jam: "00:00:00",
              status: "hadir",
              tepat_waktu: true,
              terlambat: false,
              kebijakan: true,
              catatan: "Kebijakan manajemen unit (tidak absen)"
            });
          }
        }

        if (baris.length) {
          const { error } = await admin.from("absen_presensi")
            .upsert(baris, { onConflict: "user_id,tanggal", ignoreDuplicates: true });
          if (error) return galat("Gagal mengisi: " + error.message, 500);
        }

        return jawab({ ok: true, periode, diisi: baris.length, akun: target.map((t) => t.username) });
      }

      // ── hari libur (admin) ────────────────────────────────────────────────
      case "libur_tambah": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const tgl = String(body.tanggal ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return galat("Tanggal tidak valid.", 200, "DATA");
        const { error } = await admin.from("absen_libur")
          .upsert({ tanggal: tgl, keterangan: body.keterangan ? String(body.keterangan) : null });
        if (error) return galat("Gagal menambah libur: " + error.message, 500);
        return jawab({ ok: true });
      }

      case "libur_hapus": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const { error } = await admin.from("absen_libur").delete().eq("tanggal", String(body.tanggal ?? ""));
        if (error) return galat("Gagal menghapus libur: " + error.message, 500);
        return jawab({ ok: true });
      }

      // ── foto: signed url ──────────────────────────────────────────────────
      case "foto": {
        // foto arsip di Google Drive (dikirim sebagai data URL)
        const idDrive = String(body.id ?? "");
        if (idDrive) {
          const { data: baris } = await admin.from("absen_presensi")
            .select("user_id").eq("arsip_drive_id", idDrive).maybeSingle();
          if (!baris) return galat("Foto arsip tidak ditemukan.", 404, "FOTO");
          if (baris.user_id !== profil?.id && !adminSekolah) {
            return galat("Tidak berhak melihat foto ini.", 403, "AKSES");
          }
          const bytes = await unduhDrive(idDrive);
          if (!bytes) return galat("Foto arsip tidak bisa dibuka.", 404, "FOTO");

          let biner = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            biner += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          return jawab({ url: `data:image/jpeg;base64,${btoa(biner)}`, arsip: true });
        }

        const path = String(body.path ?? "");
        if (!path) return galat("Path kosong.", 200, "DATA");
        const milikSendiri = path.startsWith(`${profil.id}/`);
        if (!milikSendiri && !adminSekolah) return galat("Tidak berhak melihat foto ini.", 403, "AKSES");
        const url = await urlFoto(path);
        if (!url) return galat("Foto tidak ditemukan.", 404, "FOTO");
        return jawab({ url });
      }

      // ── arsip foto ke Google Drive ────────────────────────────────────────
      case "arsip_harian": {
        if (!cronOk && !adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const hasil = await arsipkanBatch(Math.min(40, Number(body.batas ?? 30)), undefined, 85000);
        const { count } = await admin.from("absen_presensi")
          .select("id", { count: "exact", head: true })
          .not("foto_path", "is", null).is("arsip_drive_id", null);
        return jawab({ ok: true, ...hasil, sisa: count ?? 0, lanjut: (count ?? 0) > 0 && hasil.terarsip > 0 });
      }

      case "arsip_final": {
        if (!cronOk && !adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");

        const minta = String(body.mulai ?? "");
        const periode = /^\d{4}-\d{2}-21$/.test(minta)
          ? periodeDariMulai(minta)
          : periodeTerakhirSelesai(tanggal);
        if (periode.selesai >= tanggal) return galat("Periode belum selesai.", 200, "DATA");

        const kering = Boolean(body.kering);

        // pastikan semua foto periode ini sudah tersalin ke Drive (dibatasi waktu ±95 detik)
        let terarsip = 0;
        for (let i = 0; i < 3; i++) {
          const h = await arsipkanBatch(30, periode, 90000);
          terarsip += h.terarsip;
          if (h.berhenti || h.dibaca < 30) break;
        }

        const { count } = await admin.from("absen_presensi")
          .select("id", { count: "exact", head: true })
          .gte("tanggal", periode.mulai).lte("tanggal", periode.selesai)
          .not("foto_path", "is", null).is("arsip_drive_id", null);
        if ((count ?? 0) > 0) {
          // belum selesai: minta jalan lagi (workflow akan mengulang)
          return jawab({
            ok: true, lanjut: true, periode,
            terarsip, dihapus: 0,
            pesan: `Masih ${count} foto belum terarsip; jalankan lagi.`
          });
        }

        const { data: rows } = await admin.from("absen_presensi")
          .select("id,foto_path")
          .gte("tanggal", periode.mulai).lte("tanggal", periode.selesai)
          .not("foto_path", "is", null);

        let dihapus = 0;
        if (!kering && rows?.length) {
          const paths = rows.map((r) => r.foto_path as string);
          for (let i = 0; i < paths.length; i += 200) {
            await admin.storage.from(BUCKET).remove(paths.slice(i, i + 200));
          }
          const ids = rows.map((r) => r.id);
          for (let i = 0; i < ids.length; i += 200) {
            await admin.from("absen_presensi")
              .update({ foto_path: null, foto_dihapus: true })
              .in("id", ids.slice(i, i + 200));
          }
          dihapus = rows.length;

          const folder = await folderDrive(periode);
          await admin.from("absen_arsip").upsert({
            periode_mulai: periode.mulai,
            periode_selesai: periode.selesai,
            folder_id: folder,
            jumlah: dihapus
          });
        }

        return jawab({ ok: true, periode, terarsip, dihapus, kering });
      }

      case "versi":
        return jawab({ ok: true, versi: "1.0", waktu: wib() });

      default:
        return galat("Aksi tidak dikenal: " + aksi, 400, "DATA");
    }
  } catch (e) {
    console.error("absen error", aksi, e);
    return galat("Kesalahan server: " + (e instanceof Error ? e.message : String(e)), 500);
  }
});
