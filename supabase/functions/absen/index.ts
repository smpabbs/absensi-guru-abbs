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
  const r = await fetch(
    `${LMS_URL}/rest/v1/profiles?select=id,nama&role=eq.guru&sekolah_id=eq.${sekolahId}&order=nama`,
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
    .select("tanggal,status,tepat_waktu,terlambat")
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

// ── handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return galat("Gunakan POST.", 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return galat("Sesi habis, silakan login ulang.", 401, "UNAUTH");

  const profil = await profilDariToken(token);
  if (!profil || profil.status !== "aktif") return galat("Akun tidak aktif di LMS.", 401, "UNAUTH");

  const pengaturan = await ambilPengaturan();
  if (!pengaturan) return galat("Pengaturan absensi belum dibuat di database.", 500, "KONFIG");

  const adminSekolah = profil.role === "admin" &&
    (profil.sekolah_id === pengaturan.sekolah_id || profil.sekolah_id === null);
  const guruSekolah = profil.role === "guru" && profil.sekolah_id === pengaturan.sekolah_id;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const aksi = String(body.action ?? "");
  const { tanggal, jam } = wib();

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

        const tepatWaktu = jam <= pengaturan.batas_tot;
        const terlambat = jam > pengaturan.batas_masuk;
        const baris = {
          user_id: profil.id,
          sekolah_id: pengaturan.sekolah_id,
          nama: profil.nama,
          tanggal,
          jam,
          status: "hadir",
          tepat_waktu: tepatWaktu,
          terlambat,
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
          .select("tanggal,jam,status,tepat_waktu,terlambat,jarak_m,catatan")
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
        const bulan = String(body.bulan ?? "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(bulan)) return galat("Bulan tidak valid.", 200, "DATA");

        const [th, bl] = bulan.split("-").map(Number);
        const jumlahHari = new Date(Date.UTC(th, bl, 0)).getUTCDate();
        const awal = `${bulan}-01`;
        const akhir = `${bulan}-${String(jumlahHari).padStart(2, "0")}`;

        const guru = await daftarGuru(token, pengaturan.sekolah_id);
        const { data: rows, error } = await admin.from("absen_presensi")
          .select("user_id,tanggal,jam,status,tepat_waktu,terlambat,jarak_m,akurasi_m,foto_path,catatan,dicatat_oleh")
          .eq("sekolah_id", pengaturan.sekolah_id)
          .gte("tanggal", awal).lte("tanggal", akhir);
        if (error) return galat("Gagal memuat rekap: " + error.message, 500);

        const { data: libur } = await admin.from("absen_libur")
          .select("tanggal,keterangan").gte("tanggal", awal).lte("tanggal", akhir);

        return jawab({ guru, rows: rows ?? [], libur: libur ?? [], pengaturan });
      }

      // ── koreksi status (admin) ────────────────────────────────────────────
      case "set_status": {
        if (!adminSekolah) return galat("Hanya admin sekolah.", 403, "AKSES");
        const uid = String(body.user_id ?? "");
        const tgl = String(body.tanggal ?? "");
        const status = String(body.status ?? "");
        const catatan = body.catatan ? String(body.catatan) : null;
        if (!/^[0-9a-f-]{36}$/i.test(uid) || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
          return galat("Data tidak lengkap.", 200, "DATA");
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
          dicatat_oleh: ada?.foto_path ? (ada.dicatat_oleh ?? null) : profil.id
        };
        if (!ada) { baris.jam = "00:00:00"; baris.tepat_waktu = false; baris.terlambat = false; }

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
        const hari = Array.isArray(body.hari_kerja) ? body.hari_kerja.map(Number) : [];

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return galat("Koordinat tidak valid.", 200, "DATA");
        if (!(radius >= 10 && radius <= 5000)) return galat("Radius harus 10-5000 meter.", 200, "DATA");
        if (!/^\d{2}:\d{2}$/.test(batas) || !/^\d{2}:\d{2}$/.test(masuk)) {
          return galat("Jam TOT / jam masuk tidak valid.", 200, "DATA");
        }
        if (masuk <= batas) return galat("Jam masuk harus setelah batas TOT.", 200, "DATA");
        if (!hari.length || hari.some((h) => !(h >= 1 && h <= 7))) return galat("Hari kerja tidak valid.", 200, "DATA");

        const { error } = await admin.from("absen_pengaturan").update({
          lat, lon, radius_m: Math.round(radius), batas_tot: batas, batas_masuk: masuk,
          hari_kerja: hari, updated_at: new Date().toISOString()
        }).eq("id", true);
        if (error) return galat("Gagal menyimpan pengaturan: " + error.message, 500);
        return jawab({ ok: true });
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
        const path = String(body.path ?? "");
        if (!path) return galat("Path kosong.", 200, "DATA");
        const milikSendiri = path.startsWith(`${profil.id}/`);
        if (!milikSendiri && !adminSekolah) return galat("Tidak berhak melihat foto ini.", 403, "AKSES");
        const url = await urlFoto(path);
        if (!url) return galat("Foto tidak ditemukan.", 404, "FOTO");
        return jawab({ url });
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
