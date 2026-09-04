# Generador de contratos

Aplicación web para llenar un machote de contrato en Word y entregar un solo PDF
con el contrato y todos sus anexos (identificaciones, comprobantes, planos).

## Cómo funciona

1. **Subes tu machote una sola vez** (`.docx` o `.dotx`). Puedes subir **varios
   documentos como un mismo juego** —el contrato y su carátula, por ejemplo—: se
   generan en orden y los datos que compartan se capturan una sola vez. La app
   detecta las variables y arma el formulario automáticamente.
2. **Capturas los datos** de ese contrato en particular.
3. **Adjuntas imágenes (JPG/PNG) y PDFs**, en el orden que quieras.
4. **Descargas un PDF único**: contrato + carátula de cada anexo + los anexos,
   con folio y numeración de página al pie.

El machote se rellena como Word, no como texto plano: se conservan membretes,
tablas, tipografías, numeración y saltos de página tal como los diseñaste.

## Cómo marcar las variables en el machote

En tu documento de Word, escribe cada dato variable entre dobles llaves:

```
CONTRATO DE ARRENDAMIENTO

Celebrado en {{ciudad}} el día {{fecha_firma}}.

ARRENDADOR: {{nombre_arrendador}}
ARRENDATARIO: {{nombre_arrendatario}}
Renta mensual de ${{monto_renta}} pesos.
Inmueble: {{direccion_inmueble}}
```

### Partes que se repiten un número variable de veces

Cuando una cláusula puede llevar dos pagos o siete, se marca el bloque que se
repite entre `{{#nombre}}` y `{{/nombre}}`, cada uno **en su propio párrafo**:

```
{{#pagos}}
Un {{ordinal2}} depósito por la cantidad de ${{cifra}} M.N. ({{letra}}/100
Moneda Nacional), a más tardar el día {{fecha}}.
{{/pagos}}
```

La app muestra ese bloque como una tabla de filas: se agregan y quitan las que
hagan falta, y el documento crece con ellas. Los párrafos que solo contienen la
etiqueta desaparecen al generar, así que una lista numerada de Word no queda con
incisos vacíos y se renumera sola.

Dentro del bloque, la app aporta la numeración y no hace falta capturarla:

| Variable | Vale |
| --- | --- |
| `{{indice}}` | 1, 2, 3… |
| `{{ordinal}}` | primer, segundo, tercer… |
| `{{ordinal2}}` | segundo, tercer, cuarto… (cuando la enumeración ya empezó antes del bloque) |
| `{{ordinal3}}` | tercer, cuarto, quinto… |

Reglas prácticas:

- Usa nombres sin espacios: `{{nombre_arrendatario}}`, no `{{nombre del arrendatario}}`.
  El formulario los muestra ya legibles ("Nombre arrendatario").
- La misma variable puede repetirse cuantas veces quiera, incluso entre documentos
  distintos del mismo juego; se captura una sola vez.
- Funciona también en encabezados y pies de página.
- Si Word te autocorrige las llaves, escríbelas y luego usa *Deshacer* (Ctrl+Z)
  una vez para revertir la autocorrección conservando el texto.

## Ejecutar

### Con Docker (recomendado)

```bash
docker compose up --build
```

Abre <http://localhost:3000>.

### Sin Docker

Requiere Node 20+ y **LibreOffice Writer** instalado:

```bash
sudo apt-get install libreoffice-writer   # Debian/Ubuntu
brew install --cask libreoffice           # macOS

npm install
npm start
```

> El paquete `libreoffice-core` por sí solo no basta: sin `libreoffice-writer`
> LibreOffice no puede abrir documentos de texto y la conversión falla.

## Configuración

| Variable      | Por omisión | Para qué sirve                                 |
| ------------- | ----------- | ---------------------------------------------- |
| `PORT`        | `3000`      | Puerto del servidor.                            |
| `LIMITE_MB`   | `25`        | Tamaño máximo por archivo adjunto.              |
| `SOFFICE_BIN` | `soffice`   | Ruta al ejecutable de LibreOffice.              |

Los machotes se guardan en `data/plantillas/`. Ese directorio debe persistir
entre reinicios (en Docker ya está montado como volumen).

## API

| Método   | Ruta                   | Descripción                                          |
| -------- | ---------------------- | ---------------------------------------------------- |
| `GET`    | `/api/plantillas`      | Lista los machotes con sus campos detectados.        |
| `POST`   | `/api/plantillas`      | Sube uno o varios `.docx`/`.dotx` (campo `machote`). |
| `DELETE` | `/api/plantillas/:id`  | Elimina un machote.                                  |
| `POST`   | `/api/generar`         | Genera el PDF final y lo devuelve como descarga.     |

`POST /api/generar` recibe `multipart/form-data`:

| Campo            | Descripción                                              |
| ---------------- | -------------------------------------------------------- |
| `plantillaId`    | ID del juego de machotes.                                |
| `datos`          | JSON `{ "variable": "valor" }`; los bloques repetibles van como arreglo de objetos. |
| `anexos`         | Archivos JPG, PNG o PDF (hasta 25).                      |
| `titulosAnexos`  | JSON con el título de cada anexo, en el mismo orden.     |
| `folio`          | Folio propio; si se omite se genera `CTO-AAAAMMDD-XXXX`. |
| `separadores`    | `false` para omitir la carátula de cada anexo.           |
| `folioEn`        | Dónde estampar el folio: `anexos` (omisión), `todo`, `ninguno`. |
| `permitirVacios` | `true` para generar aunque falten campos por capturar.   |

## Estructura

```
server/index.js         API y rutas
server/lib/plantillas.js  detecta variables y rellena los .docx del juego
server/lib/pdf.js         convierte a PDF, arma anexos y une todo
public/                 interfaz web
```

## El folio al pie

Muchos machotes ya traen su propio pie de página con numeración de Word. Por eso
el folio se estampa **solo en los anexos** por omisión: así no se encima con el
pie del contrato. Puedes cambiarlo a todo el expediente o desactivarlo.

## Notas de operación

- **Datos personales.** Los contratos y sus anexos llevan información sensible
  (INE, domicilios). El PDF generado no se guarda en el servidor: se transmite y
  se descarga. Publica la app detrás de HTTPS y con control de acceso.
- **No subas machotes al repositorio.** Un contrato modelo suele traer datos de
  la empresa (cuentas bancarias, escrituras). `.gitignore` ya excluye `machotes/`
  y `data/`; súbelos por la interfaz, no por git.
- **Sin autenticación.** No trae login; cualquiera que alcance el puerto puede
  generar contratos. Ponla detrás de tu VPN o de un proxy con autenticación
  antes de exponerla a internet.
- **Concurrencia.** Cada conversión usa su propio perfil de LibreOffice, así que
  varias personas pueden generar contratos al mismo tiempo sin pisarse.
