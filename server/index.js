import path from 'node:path';
import express from 'express';
import multer from 'multer';
import * as plantillas from './lib/plantillas.js';
import { docxAPdf, armarExpediente, folioNuevo } from './lib/pdf.js';

const app = express();
const PUERTO = process.env.PORT || 3000;
const LIMITE_MB = Number(process.env.LIMITE_MB || 25);

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024, files: 30 },
});

const EXT_MACHOTE = /\.(docx|dotx)$/i;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve('public')));

const asincrono = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// --- Plantillas -----------------------------------------------------------

app.get('/api/plantillas', asincrono(async (_req, res) => {
  res.json(await plantillas.listar());
}));

app.post('/api/plantillas', subida.array('machote', 10), asincrono(async (req, res) => {
  const archivos = req.files || [];
  if (!archivos.length) return res.status(400).json({ error: 'Falta el archivo del machote.' });
  const invalido = archivos.find((f) => !EXT_MACHOTE.test(f.originalname));
  if (invalido) {
    return res.status(400).json({
      error: `"${invalido.originalname}" no es un documento de Word (.docx o .dotx).`,
    });
  }
  const meta = await plantillas.guardar(archivos);
  if (meta.campos.length === 0) {
    return res.status(400).json({
      error:
        'No se encontro ninguna variable en el machote. Marca los datos variables ' +
        'escribiendolos entre dobles llaves, por ejemplo {{nombre_arrendatario}}.',
    });
  }
  res.status(201).json(meta);
}));

app.delete('/api/plantillas/:id', asincrono(async (req, res) => {
  await plantillas.eliminar(req.params.id);
  res.status(204).end();
}));

// --- Generacion del expediente -------------------------------------------

app.post(
  '/api/generar',
  subida.fields([{ name: 'anexos', maxCount: 25 }]),
  asincrono(async (req, res) => {
    const plantilla = await plantillas.obtener(req.body.plantillaId);
    if (!plantilla) return res.status(404).json({ error: 'Machote no encontrado.' });

    let datos;
    try {
      datos = JSON.parse(req.body.datos || '{}');
    } catch {
      return res.status(400).json({ error: 'Los datos del formulario no son validos.' });
    }

    const faltantes = plantilla.campos.filter((c) => !String(datos[c] ?? '').trim());
    if (faltantes.length && req.body.permitirVacios !== 'true') {
      return res.status(400).json({ error: 'Faltan datos por capturar.', faltantes });
    }

    const titulos = JSON.parse(req.body.titulosAnexos || '[]');
    const archivos = req.files?.anexos || [];
    const anexos = archivos.map((f, i) => ({
      buffer: f.buffer,
      mimetype: f.mimetype,
      originalname: f.originalname,
      titulo: titulos[i] || f.originalname,
      separador: req.body.separadores !== 'false',
    }));

    const folio = (req.body.folio || '').trim() || folioNuevo();
    // En serie y no en paralelo: cada conversion levanta su propio LibreOffice,
    // y varios a la vez en un juego de documentos no compensa la memoria.
    const documentos = [];
    for (const buffer of plantilla.buffers) {
      documentos.push(await docxAPdf(plantillas.rellenar(buffer, datos)));
    }
    const pdf = await armarExpediente({
      documentos,
      anexos,
      folio,
      folioEn: ['todo', 'anexos', 'ninguno'].includes(req.body.folioEn)
        ? req.body.folioEn
        : 'anexos',
    });

    const nombre = `${folio}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'X-Folio': folio,
    });
    res.send(pdf);
  })
);

// --- Errores --------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const mensaje =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Cada archivo debe pesar menos de ${LIMITE_MB} MB.`
        : 'No se pudieron recibir los archivos.';
    return res.status(400).json({ error: mensaje });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Error al generar el contrato.' });
});

app.listen(PUERTO, () => {
  console.log(`Generador de contratos escuchando en http://localhost:${PUERTO}`);
});
