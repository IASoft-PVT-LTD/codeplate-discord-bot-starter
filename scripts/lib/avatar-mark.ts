// Tells the template's generated avatar apart from a picture the user put in
// assets/avatar.png, so `npm run avatar` never overwrites theirs by accident.
// The generator writes a PNG text chunk (tEXt "Software") naming itself; any
// other PNG (a designer's file, a photo, an AI image) has a different one or none.
import { crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const AVATAR_MARK = { key: 'Software', value: 'CodePlate make-avatar (scripts/make-avatar.ts)' };

function chunks(png: Buffer): { type: string; data: Buffer; end: number }[] {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) return [];
  const out = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > png.length) break;
    out.push({ type, data: png.subarray(at + 8, at + 8 + length), end });
    at = end;
  }
  return out;
}

// The tEXt entries of a PNG, as key → value.
export function pngText(png: Buffer): Record<string, string> {
  const text: Record<string, string> = {};
  for (const c of chunks(png)) {
    if (c.type !== 'tEXt') continue;
    const nul = c.data.indexOf(0);
    if (nul > 0) text[c.data.toString('latin1', 0, nul)] = c.data.toString('latin1', nul + 1);
  }
  return text;
}

// The PNG with a tEXt chunk added right after its header (IHDR).
export function withPngText(png: Buffer, key: string, value: string): Buffer {
  const ihdr = chunks(png)[0];
  if (!ihdr || ihdr.type !== 'IHDR') throw new Error('not a PNG');
  const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return Buffer.concat([png.subarray(0, ihdr.end), chunk, png.subarray(ihdr.end)]);
}

export function isTemplateAvatar(png: Buffer): boolean {
  return pngText(png)[AVATAR_MARK.key] === AVATAR_MARK.value;
}

// Why `npm run avatar` must not write over `existing` (null: go ahead).
export function avatarRefusal(existing: Buffer | null, force: boolean): string | null {
  if (!existing || force || isTemplateAvatar(existing)) return null;
  return [
    "assets/avatar.png isn't the avatar this script drew: it looks like your own picture, so I left it alone.",
    'To replace it with the generated one anyway: npm run avatar -- --force',
    '(Back it up first if you want to keep it.)',
  ].join('\n');
}
