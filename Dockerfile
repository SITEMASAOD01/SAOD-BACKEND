FROM node:18

WORKDIR /app
RUN mkdir -p /app/data


COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
