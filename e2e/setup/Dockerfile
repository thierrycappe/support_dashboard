FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .

CMD ["node_modules/.bin/tsx", "e2e/setup/start-server.ts"]
