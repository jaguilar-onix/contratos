import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const ejecutar = promisify(execFile);
const SOFFICE = process.env.SOFFICE_BIN || 'soffice';
const CARTA = { ancho: 612, alto: 792 };
const MARGEN = 36;

/**
 * Convierte el .docx ya rellenado a PDF con LibreOffice headless.
 * Cada llamada usa su propio perfil de usuario: sin eso, dos conversiones
 * simultaneas se pelean por ~/.config/libreoffice y una de las dos falla.
 */
export async function docxAPdf(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contrato-'));
  try {
    const entrada = path.join(dir, 'contrato.docx');
    await fs.writeFile(entrada, buffer);
    await ejecutar(
      SOFFICE,
      [
        `-env:UserInstallation=file://${path.join(dir, 'perfil')}`,
        '--headless',
        '--norestore',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        dir,
        entrada,
      ],
      { timeout: 120_000 }
    );
    const salida = path.join(dir, 'contrato.pdf');
    try {
      return await fs.readFile(salida);
    } catch {
      // LibreOffice termina con codigo 0 aunque no logre abrir el documento,
      // asi que la ausencia del PDF es la unica senal fiable de que fallo.
      throw new Error(
        'LibreOffice no pudo convertir el machote a PDF. Revisa que el archivo ' +
          'sea un .docx valido y que el paquete libreoffice-writer este instalado.'
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Una imagen por pagina, centrada y escalada para caber sin deformarse. */
async function imagenAPdf(buffer, mimetype) {
  const pdf = await PDFDocument.create();
  const img = /png/i.test(mimetype)
    ? await pdf.embedPng(buffer)
    : await pdf.embedJpg(buffer);

  // Una foto apaisada se acomoda mejor en una pagina horizontal.
  const horizontal = img.width > img.height;
  const ancho = horizontal ? CARTA.alto : CARTA.ancho;
  const alto = horizontal ? CARTA.ancho : CARTA.alto;

  const escala = Math.min(
    (ancho - MARGEN * 2) / img.width,
    (alto - MARGEN * 2) / img.height
  );
  const w = img.width * escala;
  const h = img.height * escala;
  pdf.addPage([ancho, alto]).drawImage(img, {
    x: (ancho - w) / 2,
    y: (alto - h) / 2,
    width: w,
    height: h,
  });
  return pdf.save();
}

/** Convierte cualquier adjunto soportado a PDF. */
export async function adjuntoAPdf(adjunto) {
  if (adjunto.mimetype === 'application/pdf') return adjunto.buffer;
  if (/^image\/(png|jpe?g)$/i.test(adjunto.mimetype)) {
    return imagenAPdf(adjunto.buffer, adjunto.mimetype);
  }
  throw new Error(`Tipo de archivo no soportado: ${adjunto.originalname}`);
}

/** Caratula que separa cada anexo del cuerpo del contrato. */
async function caratula(titulo, subtitulo) {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([CARTA.ancho, CARTA.alto]);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);

  const dibujarCentrado = (texto, fuente, tam, y) => {
    const ancho = fuente.widthOfTextAtSize(texto, tam);
    pagina.drawText(texto, {
      x: (CARTA.ancho - ancho) / 2,
      y,
      size: tam,
      font: fuente,
      color: rgb(0.1, 0.1, 0.12),
    });
  };

  dibujarCentrado(titulo.toUpperCase(), negrita, 22, CARTA.alto / 2);
  if (subtitulo) dibujarCentrado(subtitulo, normal, 13, CARTA.alto / 2 - 28);
  pagina.drawLine({
    start: { x: 150, y: CARTA.alto / 2 - 46 },
    end: { x: CARTA.ancho - 150, y: CARTA.alto / 2 - 46 },
    thickness: 1,
    color: rgb(0.75, 0.75, 0.78),
  });
  return pdf.save();
}

/**
 * Une contrato y anexos en un solo PDF.
 * `folioEn` decide donde se estampa el folio al pie: 'anexos' (por omision),
 * 'todo' o 'ninguno'. Muchos machotes ya traen su propio pie de pagina, y
 * estampar encima de el deja las dos numeraciones superpuestas.
 */
export async function armarExpediente({ documentos, anexos = [], folio, folioEn = 'anexos' }) {
  const final = await PDFDocument.create();
  final.setTitle(folio || 'Contrato');
  final.setProducer('Generador de contratos');

  const copiar = async (bytes) => {
    const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const paginas = await final.copyPages(origen, origen.getPageIndices());
    for (const p of paginas) final.addPage(p);
  };

  for (const documento of documentos) await copiar(documento);
  const paginasDelContrato = final.getPageCount();

  for (const [i, anexo] of anexos.entries()) {
    const etiqueta = `Anexo ${String.fromCharCode(65 + i)}`;
    if (anexo.separador !== false) {
      await copiar(await caratula(etiqueta, anexo.titulo || ''));
    }
    await copiar(await adjuntoAPdf(anexo));
  }

  if (folio && folioEn !== 'ninguno') {
    await pieDePagina(final, folio, folioEn === 'todo' ? 0 : paginasDelContrato);
  }
  return Buffer.from(await final.save());
}

/** Estampa el folio a partir de `desde`, respetando el pie propio del machote. */
async function pieDePagina(pdf, folio, desde) {
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const paginas = pdf.getPages();
  paginas.forEach((pagina, i) => {
    if (i < desde) return;
    const { width } = pagina.getSize();
    const texto = `${folio}  ·  Pagina ${i + 1} de ${paginas.length}`;
    const rotada = pagina.getRotation().angle % 180 !== 0;
    if (rotada) return; // el pie quedaria de lado en una pagina girada
    pagina.drawText(texto, {
      x: width - fuente.widthOfTextAtSize(texto, 8) - 36,
      y: 20,
      size: 8,
      font: fuente,
      color: rgb(0.45, 0.45, 0.5),
      rotate: degrees(0),
    });
  });
}

export function folioNuevo() {
  const f = new Date();
  const fecha = [f.getFullYear(), f.getMonth() + 1, f.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('');
  return `CTO-${fecha}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
