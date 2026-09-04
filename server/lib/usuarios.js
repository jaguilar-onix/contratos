import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const ARCHIVO = path.resolve('data/usuarios.json');

// Parametros de scrypt: encarecen adivinar la contrasena a fuerza bruta sin
// que se note al entrar. El coste va guardado con cada hash, de modo que
// subirlo despues no invalida las contrasenas ya guardadas.
const COSTO = 16384;
const LARGO = 64;

export const NOMBRE_VALIDO = /^[a-zA-Z0-9._-]{3,32}$/;
export const CLAVE_MINIMA = 8;

async function cifrar(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(clave.normalize('NFKC'), sal, LARGO, { N: COSTO });
  return `scrypt$${COSTO}$${sal}$${hash.toString('hex')}`;
}

async function coincide(clave, guardado) {
  const [algoritmo, costo, sal, hash] = String(guardado).split('$');
  if (algoritmo !== 'scrypt') return false;
  const calculado = await scrypt(clave.normalize('NFKC'), sal, LARGO, {
    N: Number(costo),
  });
  const esperado = Buffer.from(hash, 'hex');
  return (
    calculado.length === esperado.length &&
    crypto.timingSafeEqual(calculado, esperado)
  );
}

async function leer() {
  try {
    return JSON.parse(await fs.readFile(ARCHIVO, 'utf8'));
  } catch {
    return {};
  }
}

async function escribir(usuarios) {
  await fs.mkdir(path.dirname(ARCHIVO), { recursive: true });
  // Escritura en dos pasos: un corte de luz a media escritura dejaria el
  // archivo truncado y a nadie podria entrar.
  const temporal = `${ARCHIVO}.tmp`;
  await fs.writeFile(temporal, JSON.stringify(usuarios, null, 2), { mode: 0o600 });
  await fs.rename(temporal, ARCHIVO);
}

export async function listar() {
  const usuarios = await leer();
  return Object.entries(usuarios)
    .map(([nombre, datos]) => ({ nombre, creado: datos.creado }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function hay() {
  return Object.keys(await leer()).length > 0;
}

export async function verificar(nombre, clave) {
  const usuarios = await leer();
  const usuario = usuarios[nombre];
  // Se cifra igual aunque el usuario no exista: responder de inmediato
  // delataria que nombres estan dados de alta.
  if (!usuario) {
    await cifrar(String(clave));
    return false;
  }
  return coincide(String(clave), usuario.clave);
}

export async function crear(nombre, clave) {
  if (!NOMBRE_VALIDO.test(nombre)) {
    throw new Error(
      'El usuario debe tener entre 3 y 32 caracteres, sin espacios ni acentos.'
    );
  }
  if (String(clave).length < CLAVE_MINIMA) {
    throw new Error(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);
  }
  const usuarios = await leer();
  if (usuarios[nombre]) throw new Error(`El usuario "${nombre}" ya existe.`);
  usuarios[nombre] = { clave: await cifrar(String(clave)), creado: new Date().toISOString() };
  await escribir(usuarios);
}

export async function cambiarClave(nombre, clave) {
  if (String(clave).length < CLAVE_MINIMA) {
    throw new Error(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);
  }
  const usuarios = await leer();
  if (!usuarios[nombre]) throw new Error('El usuario no existe.');
  usuarios[nombre].clave = await cifrar(String(clave));
  await escribir(usuarios);
}

export async function eliminar(nombre) {
  const usuarios = await leer();
  if (!usuarios[nombre]) return;
  if (Object.keys(usuarios).length === 1) {
    throw new Error('Es el único usuario: si lo eliminas nadie podrá entrar.');
  }
  delete usuarios[nombre];
  await escribir(usuarios);
}

/**
 * Da de alta el primer usuario con lo que digan ACCESO_USUARIO y ACCESO_CLAVE.
 * Solo actua cuando no hay ninguno, de modo que la contrasena puede cambiarse
 * despues desde la aplicacion sin que la variable la revierta.
 */
export async function sembrar(nombre, clave) {
  if (!nombre || !clave || (await hay())) return null;
  await crear(nombre, clave);
  return nombre;
}
