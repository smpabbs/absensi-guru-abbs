// Menyalin file situs ke folder www (untuk dibungkus APK).
import { copyFile, mkdir } from 'node:fs/promises';

const berkas = ['index.html', 'app.js', 'styles.css', 'config.js'];
await mkdir('www', { recursive: true });
for (const f of berkas) await copyFile(f, `www/${f}`);
console.log('www siap:', berkas.join(', '));
