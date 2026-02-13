FROM node:20-bullseye

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY fonts ./fonts

ENV PORT=10000
EXPOSE 10000

CMD ["npm","start"]
