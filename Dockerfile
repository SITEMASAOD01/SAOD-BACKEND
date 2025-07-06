# Usa una imagen de Node.js oficial
FROM node:18

# Crea el directorio de trabajo
WORKDIR /app

# Copia archivos necesarios
COPY package*.json ./
RUN npm install

COPY . .
# Expone el puerto (ajusta si tu app usa otro)
EXPOSE 3000

# Comando para iniciar la app
CMD ["npm", "start"]
