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
    const docs = p.documentos.length > 1 ? `, ${p.documentos.length} documentos` : '';
    const op = new Option(`${p.nombre} (${p.campos.length} campos${docs})`, p.id);
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
  $('#documentos').textContent = plantillaActual
    ? `Documentos del juego: ${plantillaActual.documentos.map((d) => d.nombre).join(' · ')}`
    : '';
  for (const id of ['#paso-datos', '#paso-anexos', '#paso-generar']) {
    $(id).hidden = !plantillaActual;
  }
  contenedorCampos.innerHTML = '';
  if (!plantillaActual) return;

  for (const campo of plantillaActual.campos) {
    contenedorCampos.append(
      campo.tipo === 'lista' ? construirLista(campo) : construirCampo(campo.nombre)
    );
  }
}

function construirCampo(nombre, valor = '') {
  const label = document.createElement('label');
  label.className = 'campo';
  label.innerHTML = `<span>${etiquetar(nombre)}</span>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = nombre;
  input.value = valor;
  input.autocomplete = 'off';
  input.addEventListener('input', () => input.classList.remove('faltante'));
  label.append(input);
  return label;
}

/**
 * Un bloque repetible: tantas filas como haga falta. El machote las numera
 * solo, asi que agregar o quitar una no obliga a renumerar nada a mano.
 */
function construirLista(campo) {
  const bloque = document.createElement('fieldset');
  bloque.className = 'lista';
  bloque.dataset.lista = campo.nombre;
  bloque.innerHTML = `<legend>${etiquetar(campo.nombre)}</legend>`;

  const filas = document.createElement('div');
  filas.className = 'filas';

  const renumerar = () => {
    [...filas.children].forEach((fila, i) => {
      fila.querySelector('.orden').textContent = `${i + 1}.`;
      fila.querySelector('.quitar').disabled = filas.children.length === 1;
    });
  };

  const agregarFila = () => {
    const fila = document.createElement('div');
    fila.className = 'fila-lista';
    fila.innerHTML = '<span class="orden"></span>';
    const campos = document.createElement('div');
    campos.className = 'campos';
    for (const sub of campo.campos) campos.append(construirCampo(sub.nombre));
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'quitar';
    quitar.textContent = 'Quitar';
    quitar.addEventListener('click', () => {
      fila.remove();
      renumerar();
    });
    fila.append(campos, quitar);
    filas.append(fila);
    renumerar();
  };

  const agregar = document.createElement('button');
  agregar.type = 'button';
  agregar.className = 'secundario';
  agregar.textContent = `Agregar ${etiquetar(campo.nombre).toLowerCase()}`;
  agregar.addEventListener('click', agregarFila);

  bloque.append(filas, agregar);
  agregarFila();
  return bloque;
}

/** Lee el formulario como el JSON que espera la API. */
function leerDatos() {
  const datos = {};
  for (const campo of plantillaActual.campos) {
    if (campo.tipo !== 'lista') {
      datos[campo.nombre] = contenedorCampos
        .querySelector(`.campo > [name="${CSS.escape(campo.nombre)}"]`)
        ?.value.trim() ?? '';
      continue;
    }
    const bloque = contenedorCampos.querySelector(
      `[data-lista="${CSS.escape(campo.nombre)}"]`
    );
    datos[campo.nombre] = [...bloque.querySelectorAll('.fila-lista')].map((fila) =>
      Object.fromEntries(
        [...fila.querySelectorAll('input')].map((i) => [i.name, i.value.trim()])
      )
    );
  }
  return datos;
}

selectPlantilla.addEventListener('change', usarPlantillaSeleccionada);

$('#btn-subir').addEventListener('click', async () => {
  const archivos = [...$('#archivo-machote').files];
  if (!archivos.length) return mostrar('Elige uno o varios archivos .docx o .dotx.', 'error');
  const cuerpo = new FormData();
  for (const archivo of archivos) cuerpo.append('machote', archivo);
  try {
    const meta = await pedirJson('/api/plantillas', { method: 'POST', body: cuerpo });
    $('#archivo-machote').value = '';
    $('#subir-machote').open = false;
    await cargarPlantillas(meta.id);
    const docs = meta.documentos.length > 1 ? ` (${meta.documentos.length} documentos)` : '';
    mostrar(`Machote cargado con ${meta.campos.length} campos${docs}.`, 'exito');
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
  const datos = leerDatos();

  const cuerpo = new FormData();
  cuerpo.append('plantillaId', plantillaActual.id);
  cuerpo.append('datos', JSON.stringify(datos));
  cuerpo.append('folio', $('#folio').value);
  cuerpo.append('folioEn', $('#folio-en').value);
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
        contenedorCampos
          .querySelector(`.campo > [name="${CSS.escape(campo)}"]`)
          ?.classList.add('faltante');
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
