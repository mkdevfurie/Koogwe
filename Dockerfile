FROM node:20-alpine

# OpenSSL 1.1 requis par Prisma + libatomic
RUN apk add --no-cache libatomic openssl openssl-dev libc6-compat

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm ci

# Générer le client Prisma avec le bon binaire pour Alpine
RUN npx prisma generate

# Copier le reste du code
COPY . .

# Builder le projet NestJS
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
