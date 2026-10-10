import kafkajs from 'kafkajs';

// kafkajs es CommonJS y estos dos no se detectan como exports con nombre.
const { CompressionCodecs, CompressionTypes } = kafkajs as any;

// Descompresor Snappy propio (sin dependencias) para kafkajs, que no lo trae.
// rpk y Redpanda Console comprimen con Snappy por defecto; sin esto el consumidor truena.
// Soporta Snappy crudo y el enmarcado "xerial" que usan los clientes de Java.
// Solo descomprime: nosotros publicamos sin compresión.

const XERIAL_MAGIC = Buffer.from([0x82, 0x53, 0x4e, 0x41, 0x50, 0x50, 0x59, 0x00]);

function decompressRaw(src: Buffer): Buffer {
  // Longitud descomprimida en varint.
  let pos = 0;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const b = src[pos++];
    length |= (b & 0x7f) << shift;
    if (b < 0x80) break;
  }
  const out = Buffer.allocUnsafe(length);
  let o = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const type = tag & 0x03;
    if (type === 0) {
      // Literal.
      let len = tag >> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = 0;
        for (let i = 0; i < bytes; i++) len |= src[pos++] << (8 * i);
      }
      len += 1;
      src.copy(out, o, pos, pos + len);
      pos += len;
      o += len;
      continue;
    }
    let len: number;
    let offset: number;
    if (type === 1) {
      len = ((tag >> 2) & 0x07) + 4;
      offset = ((tag >> 5) << 8) | src[pos++];
    } else if (type === 2) {
      len = (tag >> 2) + 1;
      offset = src[pos] | (src[pos + 1] << 8);
      pos += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0;
      pos += 4;
    }
    if (offset === 0 || offset > o) throw new Error('Snappy: offset inválido');
    // Copia byte a byte: los rangos pueden traslaparse.
    for (let i = 0; i < len; i++, o++) out[o] = out[o - offset];
  }
  if (o !== length) throw new Error('Snappy: longitud inesperada');
  return out;
}

export function snappyDecompress(buf: Buffer): Buffer {
  if (buf.length >= 16 && buf.subarray(0, 8).equals(XERIAL_MAGIC)) {
    const chunks: Buffer[] = [];
    let pos = 16; // magic (8) + versión (4) + compatible (4)
    while (pos < buf.length) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      chunks.push(decompressRaw(buf.subarray(pos, pos + size)));
      pos += size;
    }
    return Buffer.concat(chunks);
  }
  return decompressRaw(buf);
}

export function registerSnappy() {
  CompressionCodecs[CompressionTypes.Snappy] = () => ({
    async compress() {
      throw new Error('Snappy: compresión no soportada (solo se publica sin comprimir)');
    },
    async decompress(buffer: Buffer) {
      return snappyDecompress(buffer);
    },
  });
}
