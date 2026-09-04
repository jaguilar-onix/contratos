const $ = (sel) => document.querySelector(sel);
const selectPlantilla = $('#plantilla');
const contenedorCampos = $('#campos');
const listaAnexos = $('#lista-anexos');
const estado = $('#estado');

let plantillaActual = null;
let anexos = [];

const KB = 1024;
const pesoLegible = (b) =>
  b < KB * KB ? `${Math.round(b / KB)} KB` : `${(b / (KB * KB)).toFixed(1)} MB`;

// Convierte nombre_del_arrendatario en "Nombre del arrendatario".
const etiquetar = (campo) =>
  campo.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function mostrar(mensaje, tipo = '') {
  estado.textContent = mensaje;
  estado.className = `estado ${tipo}`;
}

async function pedirJson(url, opciones) {
  const res = await fetch(url, opciones);
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(cuerpo.error || 'Error inesperado.'), cuerpo);
  return cuerpo;
}

// --- Machotes -------------------------------------------------------------

async function cargarPlantillas(seleccionar) {
  const lista = await pedirJson('/api/plantillas');
  selectPlantilla.innerHTML = lista.length
    ? ''
    : '<option value="">— Sube tu primer machote —</option>';
  for (const p of lista) {
    const op = new Option(`${p.nombre} (${p.campos.length} campos)`, p.id);
    op._meta = p;
    selectPlantilla.add(op);
  }
  if (lista.length) {
    selectPlantilla.value = seleccionar && lista.some((p) => p.id === seleccionar)
      ? seleccionar
      : lista[0].id;
  }
  if (!lista.length) $('#subir-machote').open = true;
  usarPlantillaSeleccionada();
}

function usarPlantillaSeleccionada() {
  const opcion = selectPlantilla.selectedOptions[0];
  plantillaActual = opcion?._meta || null;
  $('#btn-borrar').hidden = !plantillaActual;
  for (const id of ['#paso-datos', '#paso-anexos', '#paso-generar']) {
    $(id).hidden = !plantillaActual;
  }
  contenedorCampos.innerHTML = '';
  if (!plantillaActual) return;

  for (const campo of plantillaActual.campos) {
    const label = document.createElement('label');
    label.className = 'campo';
    label.innerHTML = `<span>${etiquetar(campo)}</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = campo;
    input.autocomplete = 'off';
    input.addEventListener('input', () => input.classList.remove('faltante'));
    label.append(input);
    contenedorCampos.append(label);
  }
}

selectPlantilla.addEventListener('change', usarPlantillaSeleccionada);

$('#btn-subir').addEventListener('click', async () => {
  const archivo = $('#archivo-machote').files[0];
  if (!archivo) return mostrar('Elige un archivo .docx.', 'error');
  const cuerpo = new FormData();
  cuerpo.append('machote', archivo);
  try {
    const meta = await pedirJson('/api/plantillas', { method: 'POST', body: cuerpo });
    $('#archivo-machote').value = '';
    $('#subir-machote').open = false;
    await cargarPlantillas(meta.id);
    mostrar(`Machote cargado con ${meta.campos.length} campos.`, 'exito');
  } catch (e) {
    mostrar(e.message, 'error');
  }
});

$('#btn-borrar').addEventListener('click', async () => {
  if (!plantillaActual) return;
  if (!confirm(`¿Eliminar el machote "${plantillaActual.nombre}"?`)) return;
  await fetch(`/api/plantillas/${plantillaActual.id}`, { method: 'DELETE' });
  await cargarPlantillas();
});

// --- Anexos ---------------------------------------------------------------

$('#archivo-anexos').addEventListener('change', (ev) => {
  anexos.push(...ev.target.files);
  ev.target.value = '';
  pintarAnexos();
});

function pintarAnexos() {
  listaAnexos.innerHTML = '';
  anexos.forEach((archivo, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.indice = i;
    li.innerHTML = `
      <span class="asa" aria-hidden="true">⠿</span>
      <span class="letra">Anexo ${String.fromCharCode(65 + i)}</span>
      <span class="nombre"></span>
      <span class="peso">${pesoLegible(archivo.size)}</span>
      <button type="button">Quitar</button>`;
    li.querySelector('.nombre').textContent = archivo.name;
    li.querySelector('button').addEventListener('click', () => {
      anexos.splice(i, 1);
      pintarAnexos();
    });
    listaAnexos.append(li);
  });
}

let arrastrado = null;
listaAnexos.addEventListener('dragstart', (ev) => {
  arrastrado = Number(ev.target.dataset.indice);
  ev.target.classList.add('arrastrando');
});
listaAnexos.addEventListener('dragend', (ev) => ev.target.classList.remove('arrastrando'));
listaAnexos.addEventListener('dragover', (ev) => ev.preventDefault());
listaAnexos.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const destino = ev.target.closest('li');
  if (!destino || arrastrado === null) return;
  const [movido] = anexos.splice(arrastrado, 1);
  anexos.splice(Number(destino.dataset.indice), 0, movido);
  arrastrado = null;
  pintarAnexos();
});

// --- Generacion -----------------------------------------------------------

$('#btn-generar').addEventListener('click', async () => {
  if (!plantillaActual) return;
  const boton = $('#btn-generar');
  const datos = {};
  for (const input of contenedorCampos.querySelectorAll('input')) {
    datos[input.name] = input.value.trim();
  }

  const cuerpo = new FormData();
  cuerpo.append('plantillaId', plantillaActual.id);
  cuerpo.append('datos', JSON.stringify(datos));
  cuerpo.append('folio', $('#folio').value);
  cuerpo.append('separadores', $('#separadores').checked);
  cuerpo.append('titulosAnexos', JSON.stringify(anexos.map((a) => a.name)));
  for (const archivo of anexos) cuerpo.append('anexos', archivo);

  boton.disabled = true;
  mostrar('Generando el PDF…');
  try {
    const res = await fetch('/api/generar', { method: 'POST', body: cuerpo });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      for (const campo of error.faltantes || []) {
        contenedorCampos.querySelector(`[name="${CSS.escape(campo)}"]`)?.classList.add('faltante');
      }
      throw new Error(error.error || 'No se pudo generar el contrato.');
    }
    const folio = res.headers.get('X-Folio') || 'contrato';
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `${folio}.pdf` }).click();
    URL.revokeObjectURL(url);
    mostrar(`Listo: ${folio}.pdf`, 'exito');
  } catch (e) {
    mostrar(e.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

cargarPlantillas().catch(() => mostrar('No se pudo conectar con el servidor.', 'error'));
