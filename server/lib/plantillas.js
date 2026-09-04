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

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DIEZ_A_VEINTINUEVE = [
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta',
  'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/**
 * Escribe un entero de 1 a 999 con palabras, en la forma que antecede a un
 * sustantivo masculino: 21 es "veintiún pagos", no "veintiuno pagos".
 */
function enLetras(n) {
  if (n === 100) return 'cien';
  if (n < 10) return UNIDADES[n];
  if (n < 30) return DIEZ_A_VEINTINUEVE[n - 10];
  if (n < 100) {
    const unidad = n % 10;
    const decena = DECENAS[Math.floor(n / 10)];
    return unidad ? `${decena} y ${UNIDADES[unidad]}` : decena;
  }
  const resto = n % 100;
  const centena = CENTENAS[Math.floor(n / 100)];
  return resto ? `${centena} ${enLetras(resto)}` : centena;
}

const mayuscula = (t) => t.replace(/^./, (c) => c.toUpperCase());

/**
 * Valores que la aplicacion deriva de un campo numerico, para que el machote
 * pueda redactar en singular o en plural sin capturar nada mas:
 *
 *   {{#pagos_varios}}{{pagos_en_letras}} pagos de …{{/pagos_varios}}
 *   {{^pagos_varios}}Un pago de …{{/pagos_varios}}
 */
const DERIVADOS = { _en_letras: 1, _varios: 1 };
const baseDerivada = (etiqueta) => {
  const m = etiqueta.match(/^(.+?)(_en_letras|_varios)$/);
  return m && DERIVADOS[m[2]] ? m[1] : null;
};

function derivar(datos) {
  const salida = { ...datos };
  for (const [clave, valor] of Object.entries(datos)) {
    const n = Number(String(valor).trim());
    if (!Number.isInteger(n) || n < 1 || n > 999) continue;
    salida[`${clave}_en_letras`] ??= mayuscula(enLetras(n));
    salida[`${clave}_varios`] ??= n > 1;
  }
  return salida;
}

const ORDINALES = [
  'primer', 'segundo', 'tercer', 'cuarto', 'quinto', 'sexto', 'séptimo',
  'octavo', 'noveno', 'décimo', 'décimo primer', 'décimo segundo',
];

/**
 * Campos en orden de aparicion, sin repetir. Un bloque {{#pagos}}…{{/pagos}}
 * se devuelve como un campo de tipo lista con sus propios campos dentro: es la
 * forma de capturar algo que se repite un numero variable de veces, como los
 * depositos de un contrato.
 */
export function detectarCampos(buffer) {
  const zip = new PizZip(buffer);
  const partes = Object.keys(zip.files).filter((f) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(f)
  );

  const campos = [];
  const abiertos = [];
  // Una condicion no crea un nivel de captura: los campos que envuelve
  // pertenecen a la lista que la contiene, o al documento si no hay ninguna.
  const listaAbierta = () => [...abiertos].reverse().find((a) => a.tipo === 'lista');
  const destino = () => listaAbierta()?.campos ?? campos;
  const agregar = (campo) => {
    if (!destino().some((c) => c.nombre === campo.nombre)) destino().push(campo);
  };

  for (const parte of partes) {
    for (const parrafo of textoPorParrafo(zip.file(parte).asText())) {
      for (const m of parrafo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const etiqueta = m[1].trim();

        if (etiqueta.startsWith('/')) {
          abiertos.pop();
          continue;
        }
        if (etiqueta.startsWith('#') || etiqueta.startsWith('^')) {
          const nombre = etiqueta.slice(1).trim();
          // {{#pagos_varios}} pregunta por un numero ya capturado; solo abre
          // una alternativa de redaccion, no una lista.
          const base = baseDerivada(nombre);
          if (base) {
            agregar({ nombre: base, tipo: 'numero' });
            abiertos.push({ tipo: 'condicion' });
            continue;
          }
          const existente = destino().find((c) => c.nombre === nombre);
          const lista = existente || { nombre, tipo: 'lista', desde: 1, campos: [] };
          if (!existente) destino().push(lista);
          abiertos.push(lista);
          continue;
        }
        // La numeracion la aporta la aplicacion; no se captura. De {{ordinalN}}
        // se toma desde que numero enumera la lista, para que el formulario
        // rotule cada fila igual que saldra en el documento.
        const numeracion = etiqueta.match(/^(?:indice|ordinal(\d*))$/);
        if (listaAbierta() && numeracion) {
          listaAbierta().desde = Number(numeracion[1]) || 1;
          continue;
        }
        // {{pagos_en_letras}} lo escribe la aplicacion: lo que se captura es
        // el numero del que se deriva.
        const base = baseDerivada(etiqueta);
        agregar(base ? { nombre: base, tipo: 'numero' } : { nombre: etiqueta, tipo: 'texto' });
      }
    }
  }
  return campos;
}

/** Nombres de los campos de texto de un nivel, para validar lo capturado. */
export function camposDeTexto(campos) {
  return campos.filter((c) => c.tipo === 'texto').map((c) => c.nombre);
}

/**
 * Numera los elementos de cada lista. Un machote puede escribir
 * "Un {{ordinal}} deposito" y la numeracion sigue siendo correcta al agregar o
 * quitar filas, sin que nadie teclee "tercero".
 *
 * Cuando la lista continua una enumeracion que ya empezo fuera del bloque
 * repetible, {{ordinal2}} arranca en "segundo", {{ordinal3}} en "tercer", etc.
 */
function numeracion(i) {
  const numeros = { indice: i + 1 };
  for (let desde = 1; desde <= ORDINALES.length - i; desde++) {
    const palabra = ORDINALES[i + desde - 1];
    if (!palabra) break;
    numeros[desde === 1 ? 'ordinal' : `ordinal${desde}`] = palabra;
  }
  return numeros;
}

function numerar(datos, campos) {
  const salida = derivar(datos);
  for (const campo of campos) {
    if (campo.tipo !== 'lista') continue;
    const elementos = Array.isArray(datos[campo.nombre]) ? datos[campo.nombre] : [];
    salida[campo.nombre] = elementos.map((elemento, i) => ({
      ...numeracion(i),
      ...numerar(elemento, campo.campos),
    }));
  }
  return salida;
}

/** Sustituye las variables y devuelve el .docx resultante. */
export function rellenar(buffer, datos, campos = []) {
  const doc = new Docxtemplater(new PizZip(buffer), {
    delimiters: DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    // Un campo sin capturar se imprime vacio en vez de romper la generacion.
    nullGetter: () => '',
  });
  doc.render(numerar(datos, campos));
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
      const existente = campos.find((c) => c.nombre === campo.nombre);
      if (!existente) {
        campos.push(campo);
      } else if (existente.tipo === 'lista' && campo.tipo === 'lista') {
        // La misma lista en dos documentos: se unen sus campos.
        for (const sub of campo.campos) {
          if (!existente.campos.some((c) => c.nombre === sub.nombre)) {
            existente.campos.push(sub);
          }
        }
      }
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
