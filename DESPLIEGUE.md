# Despliegue

La aplicación se entrega como una imagen de Docker: donde corra un contenedor,
corre esto. Hay tres caminos probados, de menos a más administración:

| Dónde | Cuesta | Para quién |
| --- | --- | --- |
| [Un Synology propio](#en-un-synology) | Nada extra | Uso interno; los datos no salen de la oficina. Requiere Container Manager |
| [Render](#en-render) | ~7 USD/mes | Publicarlo sin administrar un servidor |
| [Un VPS](#en-un-vps) | ~6.5 USD/mes | Control total, a cambio de mantenerlo |

En todos, la contraseña de acceso se configura igual: las variables
`ACCESO_USUARIO` y `ACCESO_CLAVE`. **Sin ellas la aplicación queda abierta**, lo
cual está bien en la red de la oficina y no lo está en internet.

## Dónde NO funciona

### Hosting compartido

El hosting compartido de Hostinger (y el de cualquier proveedor) no sirve, por
dos razones que no tienen rodeo:

1. **No corre Node.js.** Los planes compartidos ejecutan PHP detrás de Apache o
   LiteSpeed. Esta aplicación es un proceso de Node que debe quedarse
   levantado escuchando en un puerto, y eso el hosting compartido no lo permite.
2. **No se puede instalar LibreOffice.** La conversión de Word a PDF la hace
   LibreOffice Writer, que se instala con `apt` y pesa cientos de megabytes. En
   un hosting compartido no hay acceso de root, así que no hay forma de
   instalarlo.

El segundo punto es el de fondo: aunque el proveedor habilitara Node, sin
LibreOffice no hay PDF. Es lo que permite conservar el machote tal cual, con su
logo, sus tablas y su numeración.

El hosting compartido que ya tengas sigue sirviendo para tu sitio web. Esto va
aparte.

### Netlify, Vercel y similares

Tampoco, por el mismo motivo de fondo y con un límite más estrecho: LibreOffice
mide 256 MB instalado (101 MB comprimido) y el tope de una función de Netlify es
de 50 MB comprimidos, sin opción de usar un contenedor propio. A eso se suman el
límite de 6 MB por petición —un INE escaneado pesa más— y que no hay disco
donde vivan los machotes.

---

## En un Synology

Es la opción más barata y la más discreta con los datos: los contratos nunca
salen de la oficina.

### Antes que nada: ¿tu modelo lo admite?

Container Manager (el Docker de DSM) no está en todos los equipos. **Ábre el
Centro de paquetes y busca «Container Manager»**: si aparece, tu NAS puede;
si no aparece, no hay forma de instalarlo y conviene irse a Render.

En los modelos con procesador ARM, como el **DS223**, la disponibilidad ha
cambiado entre versiones de DSM, así que la comprobación en el propio equipo es
lo único confiable. Ten DSM actualizado a 7.2 o posterior antes de mirar.

### No construyas la imagen en el NAS

Un DS223 tiene 2 GB de RAM que comparte con DSM, y un procesador modesto.
Instalar LibreOffice ahí tarda horas o se queda sin memoria.

Por eso la imagen se construye en GitHub Actions —para PC y para ARM— y el NAS
solo la descarga desde `ghcr.io/jaguilar-onix/contratos:latest`. Ya está
publicada para las dos arquitecturas y es de acceso público, así que el NAS la
baja sin credenciales.

Cada vez que se sube un cambio al repositorio, el flujo la reconstruye.

### Instalar

1. Instala **Container Manager** desde el Centro de paquetes.
2. En **File Station**, crea la carpeta del proyecto, por ejemplo
   `/volume1/docker/contratos`, y **dentro de ella una carpeta llamada `data`**.
   Container Manager no crea las carpetas que faltan: si `data` no existe, el
   contenedor no arranca y avisa
   `Bind mount failed: '/volume1/docker/contratos/data' does not exist`.
3. En Container Manager: **Proyecto → Crear**.
   - *Nombre del proyecto:* `contratos`
   - *Ruta:* la carpeta que creaste
   - Cuando avise que no hay un `docker-compose.yml`, elige **crear uno** y
     **pega** el contenido que aparece más abajo. No hace falta copiar ningún
     archivo ni clonar el repositorio: la imagen viene del registro.
4. Siguiente hasta terminar. La primera vez tarda unos minutos: descarga la
   imagen con LibreOffice dentro.
5. Entra desde la oficina a `http://IP-DEL-NAS:3000`.

Contenido que se pega en el paso 3:

```yaml
services:
  contratos:
    image: ghcr.io/jaguilar-onix/contratos:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      LIMITE_MB: 25
    restart: unless-stopped
```

En esa carpeta `data` quedan los machotes. Es la que hay que respaldar.

Si vas a publicarlo fuera de la red local, agrega ahí mismo el usuario y la
contraseña:

```yaml
    environment:
      LIMITE_MB: 25
      ACCESO_USUARIO: onix
      ACCESO_CLAVE: una-contraseña-larga
```

### Ponerle un nombre en la red de la oficina

Para entrar como `contratos.onixliving.mx` en lugar de `http://192.168.1.50:3000`,
sin abrir nada a internet.

**1. Fija la dirección del NAS.** Si su IP cambia, el nombre deja de resolver. En
el router, reserva la IP por DHCP para el NAS, o ponsela fija en *Panel de
control → Red → Interfaz de red*.

**2. Haz que el nombre resuelva a esa IP.** Dos caminos, de menos a más trabajo:

- **Un registro A público que apunte a la IP local.** En el DNS de tu dominio,
  crea `contratos.onixliving.mx` apuntando a `192.168.1.50` (la IP del NAS). Se
  ve raro publicar una IP privada, pero funciona: dentro de la oficina resuelve
  y conecta; fuera resuelve y no lleva a ningún lado. No hay que tocar el router
  ni exponer nada.

  Algunos routers bloquean esto (lo llaman *protección de reasignación de DNS* o
  *DNS rebinding*). Si el nombre no resuelve desde una computadora de la
  oficina, es por eso: usa el siguiente camino.

  Para saber si este paso quedó: si el navegador muestra **cualquier** página
  del NAS —aunque sea la de «Your website is not set up yet»— el nombre ya
  resuelve bien y lo que falta es el paso 3.

- **DNS local en el router.** Casi todos permiten agregar un nombre que apunte a
  una IP de la red. Busca *DNS local*, *Host estático* o *DNS masquerading*.

**3. Dile al NAS a quién corresponde ese nombre.** Hay dos mecanismos y no dan
igual; cuál usar depende de si tienes **Web Station** instalado:

- **Con Web Station instalado** (lo más común, y el que manda en el puerto 80):
  usa su asistente, en *Web Station → Portal web → Crear → Portal de servicios
  web*, o el que ofrece Container Manager al abrir el proyecto:

  | Campo | Valor |
  | --- | --- |
  | Servicio | `contratos (project)` |
  | Tipo de portal | Basada en el nombre |
  | Nombre de host | `contratos.onixliving.mx` |
  | Puerto | 80 / 443 |

  El *Nombre de host* es el campo clave: si se deja vacío, Web Station responde
  con su página por omisión —«Your website is not set up yet»— en lugar de
  llevar a la aplicación.

- **Sin Web Station:** *Panel de control → Portal de inicio de sesión →
  Avanzado → Proxy inverso → Crear*, con origen HTTP / `contratos.onixliving.mx`
  / puerto `80` y destino HTTP / `localhost` / puerto `3000`.

No configures los dos para el mismo nombre: se pelean y gana Web Station.

Guarda y entra a `http://contratos.onixliving.mx` desde la oficina.

**Sobre el candado de HTTPS.** El certificado gratuito de Let's Encrypt que trae
DSM exige que el dominio sea alcanzable desde internet por el puerto 80, así que
en una instalación solo-local no se puede sacar. Las opciones son dejarlo en
HTTP —dentro de la red de la oficina es lo habitual— o generar un certificado
propio en *Panel de control → Seguridad → Certificado*, que cifra pero hace que
el navegador avise que no lo reconoce.

### Usarlo desde fuera

Si más adelante quieres entrar sin estar en la oficina, hay dos formas:

- **Por VPN.** El paquete *VPN Server* de DSM; te conectas y entras al mismo
  nombre local. Nada queda expuesto.
- **Publicándolo a internet.** Registro A hacia tu IP pública, puertos 80 y 443
  del router hacia el NAS, y el certificado de Let's Encrypt desde
  *Seguridad → Certificado*.

> Antes de publicarlo a internet, ponle contraseña: agrega `ACCESO_USUARIO` y
> `ACCESO_CLAVE` al proyecto en Container Manager y reconstrúyelo. Sin eso,
> cualquiera que dé con la dirección genera contratos y lee los datos de los
> compradores.

### Rendimiento y respaldo

Con 2 GB de RAM alcanza para generar un contrato a la vez, que es el uso real.
Espera algunos segundos más por documento que en una computadora de escritorio.

Los machotes viven en `data/plantillas`, junto al archivo de compose. Incluye esa
carpeta en las tareas de Hyper Backup que ya tengas.

**Actualizar** a una versión nueva: en Container Manager, abre el proyecto,
*Acción → Compilar* con la opción de descargar la imagen más reciente.

---

## En Render

Render construye el `Dockerfile` del repositorio y publica el servicio con HTTPS,
sin servidor que administrar. El archivo `render.yaml` ya trae la configuración.

1. Entra a Render con tu cuenta de GitHub y elige **New → Blueprint**.
2. Selecciona el repositorio `jaguilar-onix/contratos` y la rama
   `claude/contract-generator-attachments-v72com`.
3. Render lee `render.yaml` y te pide las dos variables que faltan:
   `ACCESO_USUARIO` y `ACCESO_CLAVE`.
4. Aplica. La primera construcción tarda varios minutos: descarga LibreOffice.

Quedará en `https://contratos.onrender.com`, o en tu propio dominio si lo
agregas en *Settings → Custom Domains*.

> El plan **starter** no es opcional: el gratuito no admite disco —los machotes
> se borrarían en cada despliegue— y apaga el servicio por inactividad.

Cada `git push` a esa rama vuelve a desplegar.

---

## En un VPS

Con acceso de root. En Hostinger es otro producto que el hosting compartido, y
el plan de entrada alcanza de sobra.

### Pasos

Todo lo que sigue se hace por SSH, conectado al VPS como root.

### 1. Apuntar un subdominio al servidor

En el panel donde administras el dominio, crea un registro **A** que apunte al
IP del VPS:

```
contratos.tudominio.mx   A   203.0.113.10
```

Hazlo **antes** de levantar los contenedores: al arrancar, Caddy pide el
certificado de HTTPS y necesita que el nombre ya resuelva.

### 2. Instalar Docker

Muchas imágenes de VPS ya lo traen. Si no:

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Bajar el proyecto

```bash
git clone -b claude/contract-generator-attachments-v72com \
  https://github.com/jaguilar-onix/contratos.git
cd contratos
```

### 4. Configurar el acceso

Copia el archivo de ejemplo y llena el dominio, el usuario y la contraseña:

```bash
cp .env.ejemplo .env
nano .env
```

### 5. Levantar

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

La primera vez tarda varios minutos: descarga LibreOffice. Cuando termine, entra
a `https://contratos.tudominio.mx` con el usuario y la contraseña del `.env`.

### 6. Comprobar

```bash
docker compose -f docker-compose.prod.yml ps       # los dos deben decir "running"
docker compose -f docker-compose.prod.yml logs -f  # Ctrl+C para salir
```

## Operación

Los comandos que siguen son del despliegue en un VPS.

**Actualizar a la última versión:**

```bash
cd contratos
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

**Respaldar los machotes.** Viven en `data/plantillas/`. Si se pierde ese
directorio hay que volver a subirlos:

```bash
tar czf machotes-$(date +%F).tar.gz data/plantillas
```

Los contratos generados **no** se guardan en el servidor: se descargan y ya. Si
quieres conservarlos, guárdalos donde archives el resto de la papelería.

**Ver el consumo:**

```bash
docker stats --no-stream
```

## Notas de seguridad

- La contraseña de acceso es lo único que separa los contratos de internet.
  Que sea larga, y cámbiala cuando alguien deje el equipo.
- El repositorio es público. No subas machotes: llevan datos de la empresa
  (cuentas bancarias, escrituras). El `.gitignore` ya los excluye.
- El `.env` tampoco se sube: contiene la contraseña de acceso.
- Los anexos llevan identificaciones y domicilios de los compradores. Con HTTPS
  viajan cifrados, pero quien tenga la contraseña ve todo.
