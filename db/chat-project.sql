-- Presensi di project abbs-chat-belajar (lthyqvxpiykqfaqrumcx).
-- Tabel ditaruh di schema `public` dengan awalan absen_ karena PostgREST
-- project ini hanya mengekspos schema public. RLS aktif tanpa policy:
-- hanya service_role (Edge Function `absen`) yang bisa membaca/menulis.

create table if not exists public.absen_pengaturan (
  id          boolean primary key default true check (id),
  sekolah_id  uuid not null,
  lat         double precision not null,
  lon         double precision not null,
  radius_m    integer not null default 50 check (radius_m between 10 and 5000),
  batas_tot   time not null default '06:50',
  hari_kerja  smallint[] not null default '{1,2,3,4,5,6}',
  updated_at  timestamptz not null default now()
);

insert into public.absen_pengaturan (id, sekolah_id, lat, lon, radius_m, batas_tot, hari_kerja)
values (true, '503a0f26-abeb-4a0f-94a4-2f4a23fc96d2', -7.539134, 110.805751, 50, '06:50', '{1,2,3,4,5,6}')
on conflict (id) do nothing;

create table if not exists public.absen_presensi (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  sekolah_id   uuid not null,
  nama         text,
  tanggal      date not null,
  jam          time not null default '00:00',
  status       text not null default 'hadir'
               check (status in ('hadir','izin','sakit','alpa')),
  tepat_waktu  boolean not null default false,
  lat          double precision,
  lon          double precision,
  akurasi_m    double precision,
  jarak_m      double precision,
  foto_path    text,
  catatan      text,
  dicatat_oleh uuid,
  created_at   timestamptz not null default now(),
  unique (user_id, tanggal)
);

create index if not exists absen_presensi_sekolah_tanggal_idx
  on public.absen_presensi (sekolah_id, tanggal);

create table if not exists public.absen_libur (
  tanggal    date primary key,
  keterangan text
);

alter table public.absen_pengaturan enable row level security;
alter table public.absen_presensi   enable row level security;
alter table public.absen_libur      enable row level security;

-- sisa percobaan sebelumnya (schema terpisah) tidak dipakai
drop schema if exists absensi cascade;

insert into storage.buckets (id, name, public)
values ('absensi-foto', 'absensi-foto', false)
on conflict (id) do nothing;

-- Cek: select * from public.absen_pengaturan;
