import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ARCHIVO_SECRETO = path.resolve('data/.secreto-sesion');
const COOKIE = 'sesion';
const DURACION_HORAS = Number(process.env.SESION_HORAS || 12);

let secreto;

/**
 * La firma de las sesiones se guarda junto a los datos para que un reinicio
 * del contenedor no eche a todos fuera. Si el archivo no existe, se crea.
 */
export async function iniciar() {
  try {
    secreto = await fs.readFile(ARCHIVO_SECRETO);
  } catch {
    secreto = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(ARCHIVO_SECRETO), { recursive: true });
    await fs.writeFile(ARCHIVO_SECRETO, secreto, { mode: 0o600 });
  }
}

const firmar = (texto) =>
  crypto.createHmac('sha256', secreto).update(texto).digest('base64url');

/** Vale (usuario, vencimiento) firmado; no hace falta guardarlo en el servidor. */
export function crearVale(usuario) {
  const vence = Date.now() + DURACION_HORAS * 3600_000;
  const cuerpo = Buffer.from(JSON.stringify({ usuario, vence })).toString('base64url');
  return `${cuerpo}.${firmar(cuerpo)}`;
}

export function leerVale(vale) {
  if (typeof vale !== 'string') return null;
  const corte = vale.lastIndexOf('.');
  if (corte < 1) return null;

  const cuerpo = vale.slice(0, corte);
  const firma = Buffer.from(vale.slice(corte + 1));
  const esperada = Buffer.from(firmar(cuerpo));
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(firma, esperada)) {
    return null;
  }

  try {
    const { usuario, vence } = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return vence > Date.now() ? usuario : null;
  } catch {
    return null;
  }
}

const opciones = (req) => ({
  httpOnly: true,
  sameSite: 'lax',
  // Marcar la cookie como segura sobre HTTP haria que el navegador la
  // descartara y nadie podria entrar; se activa sola al servir con HTTPS.
  secure: req.secure,
  path: '/',
});

export function guardarCookie(req, res, usuario) {
  res.cookie(COOKIE, crearVale(usuario), {
    ...opciones(req),
    maxAge: DURACION_HORAS * 3600_000,
  });
}

export function borrarCookie(req, res) {
  res.clearCookie(COOKIE, opciones(req));
}

export function usuarioDe(req) {
  return leerVale(req.cookies?.[COOKIE]);
}
