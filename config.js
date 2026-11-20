// Konfigurasi publik aplikasi absensi.
// Boleh ada di file statis: hanya URL + publishable key (untuk browser).
// JANGAN simpan service_role / secret key di sini.
window.APP_CONFIG = {
  // login & akun guru (LMS)
  supabaseUrl: "https://drlsnhnqxkcgcuskswwx.supabase.co",
  supabaseKey: "sb_publishable_nN04gESpLOjSg7KQObRfCA_6UjsRK99",

  // penyimpanan presensi (project lain, lewat Edge Function 'absen')
  dataUrl: "https://lthyqvxpiykqfaqrumcx.supabase.co",
  dataKey: "sb_publishable_OG8gcPyen5qy3kKi0T1CMw_Lojjg7KY"
};