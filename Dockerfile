FROM node:22-bookworm-slim

# LibreOffice Writer hace la conversion .docx -> PDF conservando el formato del
# machote. libreoffice-core por si solo NO puede abrir documentos de texto.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-liberation \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
