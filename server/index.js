import path from 'node:path';
import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { entrar, exigirSesion, salir } from './lib/acceso.js';
import * as plantillas from './lib/plantillas.js';
import * as sesion from './lib/sesion.js';
import * as usuarios from './lib/usuarios.js';
import { docxAPdf, armarExpediente, folioNuevo } from './lib/pdf.js';

const app = express();
const PUERTO = process.env.PORT || 3000;
const LIMITE_MB = Number(process.env.LIMITE_MB || 25);

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024, files: 30 },
});

const EXT_MACHOTE = /\.(docx|dotx)$/i;

// Render y otras plataformas consultan esta ruta para saber si el servicio
// esta vivo; queda fuera del login o siempre responderia 401.
app.get('/salud', (_req, res) => res.json({ ok: true }));

const asincrono = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Detras del proxy de DSM o de Caddy, esto es lo que permite saber si la
// visita llego por HTTPS y si la IP del intento es la real.
app.set('trust proxy', true);

// La pantalla de entrada y lo que necesita para pintarse.
const PUBLICAS = ['/salud', '/entrar', '/entrar.html', '/api/entrar', '/styles.css'];

app.get('/entrar', (req, res) => {
  if (sesion.usuarioDe(req)) return res.redirect('/');
  res.sendFile(path.resolve('public/entrar.html'));
});
app.post('/api/entrar', asincrono(entrar));

app.use(exigirSesion({ publicas: PUBLICAS }));

app.use(express.static(path.resolve('public')));

// --- Sesion y usuarios ----------------------------------------------------

app.get('/api/yo', (req, res) => res.json({ usuario: req.usuario }));
app.post('/api/salir', salir);

app.get('/api/usuarios', asincrono(async (_req, res) => {
  res.json(await usuarios.listar());
}));

app.post('/api/usuarios', asincrono(async (req, res) => {
  const { usuario, clave } = req.body || {};
  await usuarios.crear(String(usuario || '').trim(), clave);
  res.status(201).json({ usuario });
}));

app.post('/api/usuarios/clave', asincrono(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!(await usuarios.verificar(req.usuario, actual))) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }
  await usuarios.cambiarClave(req.usuario, nueva);
  res.json({ ok: true });
}));

app.delete('/api/usuarios/:nombre', asincrono(async (req, res) => {
  if (req.params.nombre === req.usuario) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
  }
  await usuarios.eliminar(req.params.nombre);
  res.status(204).end();
}));


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

    const faltantes = plantillas
      .camposDeTexto(plantilla.campos)
      .filter((c) => !String(datos[c] ?? '').trim());
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
      separador: req.body.separadores === 'true',
    }));

    // El folio lo escribe quien genera el contrato, y de ahi pasa a una
    // cabecera HTTP, al nombre del archivo y al pie de cada pagina.
    const folio =
      (req.body.folio || '')
        .replace(/[^\w.\-/ ]+/g, ' ')
        .trim()
        .slice(0, 80) || folioNuevo();
    // En serie y no en paralelo: cada conversion levanta su propio LibreOffice,
    // y varios a la vez en un juego de documentos no compensa la memoria.
    const documentos = [];
    for (const buffer of plantilla.buffers) {
      documentos.push(
        await docxAPdf(plantillas.rellenar(buffer, datos, plantilla.campos))
      );
    }
    const pdf = await armarExpediente({
      documentos,
      anexos,
      folio,
      folioEn: ['todo', 'anexos', 'ninguno'].includes(req.body.folioEn)
        ? req.body.folioEn
        : 'anexos',
    });

    const nombre = `${folio.replaceAll('/', '_')}.pdf`;
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
  // Los mensajes de usuarios.js son para leerse: explican que corregir.
  if (err instanceof Error && /^(El usuario|La contraseña|Es el único)/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
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

await sesion.iniciar();

const sembrado = await usuarios.sembrar(
  process.env.ACCESO_USUARIO,
  process.env.ACCESO_CLAVE
);
if (sembrado) console.log(`Usuario inicial creado: ${sembrado}`);

app.listen(PUERTO, () => {
  console.log(`Generador de contratos escuchando en http://localhost:${PUERTO}`);
  if (!process.env.ACCESO_USUARIO && !sembrado) {
    usuarios.hay().then((existe) => {
      if (!existe) {
        console.warn(
          'AVISO: no hay ningún usuario dado de alta y nadie podrá entrar. ' +
            'Define ACCESO_USUARIO y ACCESO_CLAVE para crear el primero.'
        );
      }
    });
  }
});
