import crypto from 'node:crypto';

/**
 * Contrasena de acceso a la aplicacion. Los contratos y sus anexos llevan
 * identificaciones y domicilios de los compradores, asi que en cuanto la
 * aplicacion sale a internet deja de ser opcional.
 *
 * Se activa cuando estan definidas ACCESO_USUARIO y ACCESO_CLAVE; sin ellas la
 * aplicacion corre abierta, que es lo comodo en una computadora de la oficina.
 */
export function acceso({ usuario, clave, publicas = [] }) {
  if (!usuario || !clave) {
    return (req, _res, next) => next();
  }

  // Comparacion de duracion constante: comparar con === delata la contrasena
  // por el tiempo que tarda en fallar.
  const iguales = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  return (req, res, next) => {
    if (publicas.includes(req.path)) return next();

    const [tipo, credencial] = (req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && credencial) {
      const texto = Buffer.from(credencial, 'base64').toString('utf8');
      const corte = texto.indexOf(':');
      if (
        corte > 0 &&
        iguales(texto.slice(0, corte), usuario) &&
        iguales(texto.slice(corte + 1), clave)
      ) {
        return next();
      }
    }

    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="Generador de contratos", charset="UTF-8"')
      .json({ error: 'Se requiere usuario y contraseña.' });
  };
}
