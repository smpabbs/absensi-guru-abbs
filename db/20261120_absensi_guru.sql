-- 20261120_absensi_guru.sql
-- Absensi Guru SMP ABBS Surakarta.
-- Jalankan di Supabase project LMS (ref drlsnhnqxkcgcuskswwx) → SQL Editor.
-- Aman diulang.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabel
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.absensi_guru (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  sekolah_id   uuid not null references public.sekolah(id),
  tanggal      date not null,                          -- WIB
  jam          time not null default '00:00',          -- WIB
  status       text not null default 'hadir'
               check (status in ('hadir','izin','sakit','alpa')),
  tepat_waktu  boolean not null default false,
  lat          double precision,
  lon          double precision,
  akurasi_m    double precision,
  jarak_m      double precision,
  foto_path    text,
  catatan      text,
  dicatat_oleh uuid references public.profiles(id),    -- null = absen sendiri
  created_at   timestamptz not null default now(),
  unique (user_id, tanggal)
);

create index if not exists absensi_guru_sekolah_tanggal_idx
  on public.absensi_guru (sekolah_id, tanggal);

create table if not exists public.absensi_libur (
  tanggal    date primary key,
  keterangan text
);

-- Satu baris konfigurasi. Radius & jam batas TOT bisa diubah admin dari aplikasi.
create table if not exists public.absensi_pengaturan (
  id           boolean primary key default true check (id),
  sekolah_id   uuid not null references public.sekolah(id),
  lat          double precision not null,
  lon          double precision not null,
  radius_m     integer not null default 50 check (radius_m between 10 and 5000),
  batas_tot    time not null default '06:50',
  hari_kerja   smallint[] not null default '{1,2,3,4,5,6}',  -- 1=Senin … 7=Minggu
  updated_at   timestamptz not null default now()
);

insert into public.absensi_pengaturan (id, sekolah_id, lat, lon, radius_m, batas_tot, hari_kerja)
values (true, '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2', -7.539134, 110.805751, 50, '06:50', '{1,2,3,4,5,6}')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.absensi_guru        enable row level security;
alter table public.absensi_libur       enable row level security;
alter table public.absensi_pengaturan  enable row level security;

drop policy if exists absensi_guru_select on public.absensi_guru;
create policy absensi_guru_select on public.absensi_guru
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_admin()
      and sekolah_id = (select p.sekolah_id from public.profiles p where p.id = auth.uid())
    )
  );
-- Tidak ada policy insert/update/delete: semua tulis lewat fungsi security definer
-- di bawah. Klien tidak bisa mengarang jam, jarak, atau status.

drop policy if exists absensi_libur_select on public.absensi_libur;
create policy absensi_libur_select on public.absensi_libur
  for select to authenticated using (true);

drop policy if exists absensi_libur_tulis on public.absensi_libur;
create policy absensi_libur_tulis on public.absensi_libur
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists absensi_pengaturan_select on public.absensi_pengaturan;
create policy absensi_pengaturan_select on public.absensi_pengaturan
  for select to authenticated using (true);

drop policy if exists absensi_pengaturan_update on public.absensi_pengaturan;
create policy absensi_pengaturan_update on public.absensi_pengaturan
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Login: username LMS → email auth
-- ─────────────────────────────────────────────────────────────────────────────
-- get_email_by_username() milik LMS hanya meloloskan role='guru'.
-- Versi ini meloloskan guru dan admin (dipakai akun 'admin.abbs' untuk rekap).
create or replace function public.absensi_login_email(p_username text)
returns text
language sql
security definer
set search_path to 'public'
as $$
  select au.email
  from public.profiles p
  join auth.users au on au.id = p.id
  where lower(p.username) = lower(trim(p_username))
    and p.role in ('guru','admin')
    and p.status = 'aktif'
  limit 1;
$$;

revoke all on function public.absensi_login_email(text) from public;
grant execute on function public.absensi_login_email(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Absen: validasi radius, jam, TOT, dan absen ganda di server
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.absensi_absen(
  p_lat      double precision,
  p_lon      double precision,
  p_akurasi  double precision,
  p_foto_path text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_profil record;
  v_cfg    record;
  v_now    timestamp;
  v_tgl    date;
  v_jam    time;
  v_jarak  double precision;
  v_id     uuid;
  v_lama   record;
  v_tot    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTH', 'message', 'Sesi habis, silakan login ulang.');
  end if;

  select id, role, status, sekolah_id, nama into v_profil
  from public.profiles where id = v_uid;

  if v_profil.id is null or v_profil.role <> 'guru' or v_profil.status <> 'aktif' then
    return jsonb_build_object('ok', false, 'code', 'AKUN', 'message', 'Akun ini tidak berhak absen. Akun admin hanya untuk rekap.');
  end if;
  if v_profil.sekolah_id is null then
    return jsonb_build_object('ok', false, 'code', 'SEKOLAH', 'message', 'Profil belum terhubung ke sekolah.');
  end if;

  select * into v_cfg from public.absensi_pengaturan where id;
  if v_cfg.id is null then
    return jsonb_build_object('ok', false, 'code', 'KONFIG', 'message', 'Pengaturan absensi belum diisi admin.');
  end if;

  v_now := now() at time zone 'Asia/Jakarta';
  v_tgl := v_now::date;
  v_jam := v_now::time(0);

  if not (extract(isodow from v_tgl)::smallint = any (v_cfg.hari_kerja)) then
    return jsonb_build_object('ok', false, 'code', 'LIBUR', 'message', 'Hari ini bukan hari kerja.');
  end if;
  if exists (select 1 from public.absensi_libur where tanggal = v_tgl) then
    return jsonb_build_object('ok', false, 'code', 'LIBUR', 'message', 'Hari ini tercatat libur.');
  end if;
  if p_lat is null or p_lon is null then
    return jsonb_build_object('ok', false, 'code', 'LOKASI', 'message', 'Lokasi tidak terbaca. Aktifkan GPS lalu coba lagi.');
  end if;

  v_jarak := 2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - v_cfg.lat) / 2), 2)
    + cos(radians(v_cfg.lat)) * cos(radians(p_lat))
    * power(sin(radians(p_lon - v_cfg.lon) / 2), 2)
  ));

  if v_jarak > v_cfg.radius_m then
    return jsonb_build_object(
      'ok', false, 'code', 'RADIUS',
      'jarak', round(v_jarak)::int, 'radius_m', v_cfg.radius_m,
      'message', format('Anda %s m dari titik sekolah. Maksimal %s m.', round(v_jarak)::int, v_cfg.radius_m)
    );
  end if;

  v_tot := v_jam <= v_cfg.batas_tot;

  insert into public.absensi_guru
    (user_id, sekolah_id, tanggal, jam, status, tepat_waktu, lat, lon, akurasi_m, jarak_m, foto_path)
  values
    (v_uid, v_profil.sekolah_id, v_tgl, v_jam, 'hadir', v_tot, p_lat, p_lon, p_akurasi, v_jarak, nullif(trim(p_foto_path), ''))
  on conflict (user_id, tanggal) do nothing
  returning id into v_id;

  if v_id is null then
    select jam, tepat_waktu, jarak_m, foto_path into v_lama
    from public.absensi_guru where user_id = v_uid and tanggal = v_tgl;
    return jsonb_build_object(
      'ok', false, 'code', 'SUDAH',
      'jam', to_char(v_lama.jam, 'HH24:MI'),
      'tepat_waktu', v_lama.tepat_waktu,
      'jarak', round(v_lama.jarak_m)::int,
      'foto_path', v_lama.foto_path,
      'message', format('Anda sudah absen hari ini pukul %s.', to_char(v_lama.jam, 'HH24:MI'))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'tanggal', v_tgl,
    'jam', to_char(v_jam, 'HH24:MI'),
    'tepat_waktu', v_tot,
    'batas_tot', to_char(v_cfg.batas_tot, 'HH24:MI'),
    'jarak', round(v_jarak)::int,
    'radius_m', v_cfg.radius_m,
    'nama', v_profil.nama
  );
end $$;

revoke all on function public.absensi_absen(double precision, double precision, double precision, text) from public;
grant execute on function public.absensi_absen(double precision, double precision, double precision, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Admin: koreksi status satu guru satu tanggal (izin/sakit/alpa/hadir/hapus)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.absensi_set_status(
  p_user_id  uuid,
  p_tanggal  date,
  p_status   text,
  p_catatan  text default null,
  p_hapus    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sek uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'AKSES', 'message', 'Hanya admin yang boleh mengubah status.');
  end if;

  select sekolah_id into v_sek from public.profiles where id = auth.uid();

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and sekolah_id = v_sek and role = 'guru'
  ) then
    return jsonb_build_object('ok', false, 'code', 'AKSES', 'message', 'Guru ini bukan anggota sekolah Anda.');
  end if;

  if p_hapus then
    delete from public.absensi_guru where user_id = p_user_id and tanggal = p_tanggal;
    return jsonb_build_object('ok', true, 'hapus', true);
  end if;

  if p_status not in ('hadir','izin','sakit','alpa') then
    return jsonb_build_object('ok', false, 'code', 'DATA', 'message', 'Status tidak dikenal.');
  end if;

  insert into public.absensi_guru (user_id, sekolah_id, tanggal, jam, status, tepat_waktu, catatan, dicatat_oleh)
  values (
    p_user_id, v_sek, p_tanggal, '00:00', p_status, false,
    nullif(trim(p_catatan), ''), auth.uid()
  )
  on conflict (user_id, tanggal) do update
    set status      = excluded.status,
        catatan     = excluded.catatan,
        -- absen mandiri (ada foto) tetap dihitung sebagai absen guru, bukan catatan admin
        dicatat_oleh = case when absensi_guru.foto_path is null
                            then excluded.dicatat_oleh
                            else absensi_guru.dicatat_oleh end;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.absensi_set_status(uuid, date, text, text, boolean) from public;
grant execute on function public.absensi_set_status(uuid, date, text, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Storage: foto absen privat
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('absensi-foto', 'absensi-foto', false)
on conflict (id) do nothing;

drop policy if exists "absensi_foto_upload" on storage.objects;
create policy "absensi_foto_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'absensi-foto'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "absensi_foto_baca" on storage.objects;
create policy "absensi_foto_baca" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'absensi-foto'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Cek setelah dijalankan
-- ─────────────────────────────────────────────────────────────────────────────
-- select * from absensi_pengaturan;
-- select absensi_login_email('admin.abbs');   -- harus mengembalikan email admin
