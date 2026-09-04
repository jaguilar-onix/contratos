# Generador de contratos

Aplicación web para llenar un machote de contrato en Word y entregar un solo PDF
con el contrato y todos sus anexos (identificaciones, comprobantes, planos).

## Cómo funciona

1. **Subes tu machote `.docx`** una sola vez. La app detecta las variables y arma
   el formulario automáticamente.
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

Reglas prácticas:

- Usa nombres sin espacios: `{{nombre_arrendatario}}`, no `{{nombre del arrendatario}}`.
  El formulario los muestra ya legibles ("Nombre arrendatario").
- La misma variable puede repetirse cuantas veces quiera; se captura una sola vez.
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
| `POST`   | `/api/plantillas`      | Sube un machote (`multipart`, campo `machote`).      |
| `DELETE` | `/api/plantillas/:id`  | Elimina un machote.                                  |
| `POST`   | `/api/generar`         | Genera el PDF final y lo devuelve como descarga.     |

`POST /api/generar` recibe `multipart/form-data`:

| Campo            | Descripción                                              |
| ---------------- | -------------------------------------------------------- |
| `plantillaId`    | ID del machote.                                          |
| `datos`          | JSON `{ "variable": "valor" }`.                          |
| `anexos`         | Archivos JPG, PNG o PDF (hasta 25).                      |
| `titulosAnexos`  | JSON con el título de cada anexo, en el mismo orden.     |
| `folio`          | Folio propio; si se omite se genera `CTO-AAAAMMDD-XXXX`. |
| `separadores`    | `false` para omitir la carátula de cada anexo.           |
| `permitirVacios` | `true` para generar aunque falten campos por capturar.   |

## Estructura

```
server/index.js         API y rutas
server/lib/plantillas.js  detecta variables y rellena el .docx
server/lib/pdf.js         convierte a PDF, arma anexos y une todo
public/                 interfaz web
```

## Notas de operación

- **Datos personales.** Los contratos y sus anexos llevan información sensible
  (INE, domicilios). El PDF generado no se guarda en el servidor: se transmite y
  se descarga. Publica la app detrás de HTTPS y con control de acceso.
- **Sin autenticación.** No trae login; cualquiera que alcance el puerto puede
  generar contratos. Ponla detrás de tu VPN o de un proxy con autenticación
  antes de exponerla a internet.
- **Concurrencia.** Cada conversión usa su propio perfil de LibreOffice, así que
  varias personas pueden generar contratos al mismo tiempo sin pisarse.
