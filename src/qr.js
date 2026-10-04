import QRCode from 'qrcode';

/**
 * Render payload QRIS menjadi PNG.
 *
 * `merchantid` hanya menghasilkan string QRIS, sedangkan pembeli perlu gambar
 * untuk dipindai. Rendersesi memakai `qrcode` dan dimuat lewat import dinamis
 * supaya modul ini tidak ikut ter-load kalau pemanggil tidak pernah meminta PNG.
 */
export async function renderQrPng(qrString, options = {}) {
  if (!qrString || typeof qrString !== 'string') {
    throw new TypeError('qrString wajib diisi sebagai string');
  }

  const { width = 512, margin = 2 } = options;

  return QRCode.toBuffer(qrString, {
    type: 'png',
    width,
    margin,
    // QRIS payload memakai karakter non-ASCII pada field nama merchant, jadi
    // mode byte dipilih agar glyph di luar ASCII tidak merusak pemindaian.
    errorCorrectionLevel: 'M',
  });
}

/** Render payload QRIS menjadi string SVG, untuk tampilan vektor di web. */
export async function renderQrSvg(qrString, options = {}) {
  if (!qrString || typeof qrString !== 'string') {
    throw new TypeError('qrString wajib diisi sebagai string');
  }

  const { margin = 2 } = options;

  return QRCode.toString(qrString, {
    type: 'svg',
    margin,
    errorCorrectionLevel: 'M',
  });
}