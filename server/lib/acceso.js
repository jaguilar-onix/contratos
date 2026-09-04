import * as sesion from './sesion.js';
import * as usuarios from './usuarios.js';

// Freno a la adivinacion de contrasenas: unos pocos intentos fallidos por
// direccion y luego una espera. Vive en memoria; reiniciar lo limpia, que es
// suficiente para lo que protege.
const INTENTOS_MAXIMOS = 8;
const ESPERA_MS = 10 * 60_000;
const intentos = new Map();

const ahora = () => Date.now();

function bloqueado(llave) {
  const registro = intentos.get(llave);
  if (!registro) return 0;
  if (ahora() > registro.hasta) {
    intentos.delete(llave);
    return 0;
  }
  return registro.fallos >= INTENTOS_MAXIMOS
    ? Math.ceil((registro.hasta - ahora()) / 60_000)
    : 0;
}

function anotarFallo(llave) {
  const registro = intentos.get(llave) || { fallos: 0, hasta: 0 };
  registro.fallos += 1;
  registro.hasta = ahora() + ESPERA_MS;
  intentos.set(llave, registro);
}

/** Deja pasar a quien traiga una sesion valida; al resto lo manda a entrar. */
export function exigirSesion({ publicas = [] } = {}) {
  return (req, res, next) => {
    if (publicas.includes(req.path)) return next();

    const usuario = sesion.usuarioDe(req);
    if (usuario) {
      req.usuario = usuario;
      return next();
    }

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Tu sesión terminó. Vuelve a entrar.' });
    }
    res.redirect(`/entrar?destino=${encodeURIComponent(req.originalUrl)}`);
  };
}

export async function entrar(req, res) {
  const { usuario, clave } = req.body || {};
  const llave = req.ip || 'desconocido';

  const minutos = bloqueado(llave);
  if (minutos) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Vuelve a intentar en ${minutos} minuto(s).`,
    });
  }

  if (!usuario || !clave || !(await usuarios.verificar(String(usuario), clave))) {
    anotarFallo(llave);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  intentos.delete(llave);
  sesion.guardarCookie(req, res, String(usuario));
  res.json({ usuario: String(usuario) });
}

export function salir(req, res) {
  sesion.borrarCookie(req, res);
  res.json({ ok: true });
}
