import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const DIR = path.resolve('data/plantillas');
const DELIMITERS = { start: '{{', end: '}}' };

const TIPO_PLANTILLA =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
const TIPO_DOCUMENTO =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/**
 * Un machote suele venir como .dotx (plantilla de Word). Por dentro es igual a
 * un .docx salvo el content type, y LibreOffice se niega a convertirlo si la
 * extension y el tipo no concuerdan. Normalizarlo aqui deja un solo formato
 * circulando por el resto de la aplicacion.
 */
export function normalizar(buffer) {
  const zip = new PizZip(buffer);
  const tipos = zip.file('[Content_Types].xml');
  if (!tipos) throw new Error('El archivo no es un documento de Word valido.');
  const xml = tipos.asText();
  if (!xml.includes(TIPO_PLANTILLA)) return buffer;
  zip.file('[Content_Types].xml', xml.replaceAll(TIPO_PLANTILLA, TIPO_DOCUMENTO));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Word parte el texto de un parrafo en varios <w:t> (por revisiones, correccion
 * ortografica, cambios de formato). Para descubrir las variables hay que unir
 * el texto de cada parrafo antes de buscar los delimitadores.
 */
function textoPorParrafo(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((t) => t[1])
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  );
}

/** Nombres de variable en orden de aparicion, sin repetir. */
export function detectarCampos(buffer) {
  const zip = new PizZip(buffer);
  const partes = Object.keys(zip.files).filter((f) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(f)
  );
  const campos = [];
  for (const parte of partes) {
    for (const parrafo of textoPorParrafo(zip.file(parte).asText())) {
      for (const m of parrafo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const nombre = m[1].trim();
        // Las etiquetas de seccion/bucle de docxtemplater no son campos de captura.
        if (/^[#/^]/.test(nombre)) continue;
        if (!campos.includes(nombre)) campos.push(nombre);
      }
    }
  }
  return campos;
}

/** Sustituye las variables y devuelve el .docx resultante. */
export function rellenar(buffer, datos) {
  const doc = new Docxtemplater(new PizZip(buffer), {
    delimiters: DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    // Un campo sin capturar se imprime vacio en vez de romper la generacion.
    nullGetter: () => '',
  });
  doc.render(datos);
  return doc.toBuffer();
}

const sinExtension = (nombre) => nombre.replace(/\.(docx|dotx)$/i, '');

/**
 * Un juego de contrato puede constar de varios documentos de Word (el contrato
 * y su caratula, por ejemplo). Se guardan juntos y en orden: comparten los
 * datos, asi que un campo repetido entre documentos se captura una sola vez.
 */
export async function guardar(archivos) {
  await fs.mkdir(DIR, { recursive: true });
  const id = crypto.randomUUID();

  const documentos = [];
  const campos = [];
  for (const [i, archivo] of archivos.entries()) {
    const buffer = normalizar(archivo.buffer);
    await fs.writeFile(path.join(DIR, `${id}-${i}.docx`), buffer);
    documentos.push({ nombre: sinExtension(archivo.originalname) });
    for (const campo of detectarCampos(buffer)) {
      if (!campos.includes(campo)) campos.push(campo);
    }
  }

  const meta = {
    id,
    nombre: sinExtension(archivos[0].originalname),
    documentos,
    campos,
    creado: new Date().toISOString(),
  };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export async function listar() {
  await fs.mkdir(DIR, { recursive: true });
  const archivos = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
  const metas = await Promise.all(
    archivos.map((f) => fs.readFile(path.join(DIR, f), 'utf8').then(JSON.parse))
  );
  return metas.sort((a, b) => b.creado.localeCompare(a.creado));
}

export async function obtener(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const meta = JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), 'utf8'));
    const buffers = await Promise.all(
      meta.documentos.map((_, i) => fs.readFile(path.join(DIR, `${id}-${i}.docx`)))
    );
    return { ...meta, buffers };
  } catch {
    return null;
  }
}

export async function eliminar(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const meta = await obtener(id);
  for (const [i] of (meta?.documentos || []).entries()) {
    await fs.rm(path.join(DIR, `${id}-${i}.docx`), { force: true });
  }
  await fs.rm(path.join(DIR, `${id}.json`), { force: true });
  return true;
}
