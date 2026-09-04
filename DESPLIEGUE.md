# Despliegue

## Por qué no funciona en un hosting compartido

El hosting compartido de Hostinger (y el de cualquier proveedor) no sirve para
esta aplicación, por dos razones que no tienen rodeo:

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

## Dónde sí funciona

Un **VPS**, que es una máquina con acceso de root. En Hostinger es otro
producto, y el plan de entrada alcanza de sobra: la conversión de un contrato
tarda un par de segundos y consume poca memoria.

El hosting compartido que ya tengas sigue sirviendo para tu sitio web. Esto va
aparte, en un subdominio.

## Pasos

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

La aplicación no trae login propio, así que Caddy pide usuario y contraseña
antes de dejar entrar. Genera la contraseña cifrada:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'la-que-elijas'
```

Copia el archivo de ejemplo y llena los tres valores:

```bash
cp .env.ejemplo .env
nano .env
```

> En el `.env`, cada `$` del hash debe escribirse `$$`. Si no, Docker Compose se
> come parte del texto y la contraseña no funciona.

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

- La contraseña de Caddy es lo único que separa los contratos de internet.
  Que sea larga, y cámbiala cuando alguien deje el equipo.
- El repositorio es público. No subas machotes: llevan datos de la empresa
  (cuentas bancarias, escrituras). El `.gitignore` ya los excluye.
- El `.env` tampoco se sube: contiene la contraseña de acceso.
- Los anexos llevan identificaciones y domicilios de los compradores. Con HTTPS
  viajan cifrados, pero quien tenga la contraseña ve todo.
