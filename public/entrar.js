const formulario = document.getElementById('formulario');
const estado = document.getElementById('estado');
const verClave = document.getElementById('ver-clave');

verClave.addEventListener('click', () => {
  const oculta = formulario.clave.type === 'password';
  formulario.clave.type = oculta ? 'text' : 'password';
  verClave.textContent = oculta ? 'Ocultar' : 'Ver';
  verClave.setAttribute('aria-label',
    oculta ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
  formulario.clave.focus();
});

formulario.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = formulario.querySelector('button[type=submit]');
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  estado.textContent = '';
  estado.className = 'estado';

  try {
    const datos = Object.fromEntries(new FormData(formulario));
    const res = await fetch('/api/entrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(datos),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || 'No se pudo entrar.');
    }
    const destino = new URLSearchParams(location.search).get('destino');
    // Solo rutas de este mismo sitio: un destino con http:// llevaria fuera.
    location.href = destino && destino.startsWith('/') ? destino : '/';
  } catch (e) {
    estado.textContent = e.message;
    estado.className = 'estado error';
    formulario.clave.value = '';
    formulario.clave.focus();
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});
