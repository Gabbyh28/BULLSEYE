// BULLSEYE — encrypt player intro videos for a public site.
//
// Usage (the password is read from the environment, never from the command line):
//   CLIP_PASSWORD='your group password' node tools/encrypt-clips.mjs <out-dir> "<name>=<video.mp4>" ...
//
// Writes <out-dir>/clips.json and <out-dir>/c1.bin, c2.bin, ... Every video is
// encrypted with AES-256-GCM under a key derived from the password (PBKDF2-SHA256).
// Even the list of names is encrypted, so the public files reveal nothing but
// their sizes. The app asks for the password once per device to unlock them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

export const ITERATIONS = 600000;
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');

export async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** iv (12 bytes) followed by the AES-GCM ciphertext and tag. */
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function main() {
  const [outDir, ...pairs] = process.argv.slice(2);
  const password = process.env.CLIP_PASSWORD;
  if (!outDir || !pairs.length || !password) {
    console.error('Usage: CLIP_PASSWORD=... node tools/encrypt-clips.mjs <out-dir> "<name>=<video>" ...');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Use a password of at least 10 characters.');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const index = {};
  let n = 0;
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const name = pair.slice(0, at).trim();
    const file = pair.slice(at + 1);
    const out = `c${++n}.bin`;
    writeFileSync(join(outDir, out), await seal(key, readFileSync(file)));
    index[name] = { file: out, type: file.endsWith('.webm') ? 'video/webm' : 'video/mp4' };
    console.log(`${name} -> ${out}`);
  }
  const manifest = {
    v: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt) },
    // the name list, encrypted too: { name: { file, type } }
    index: b64(await seal(key, enc.encode(JSON.stringify(index)))),
  };
  writeFileSync(join(outDir, 'clips.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${join(outDir, 'clips.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
