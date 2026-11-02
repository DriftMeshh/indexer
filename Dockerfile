FROM node:22-slim

# better-sqlite3 ships prebuilt binaries for common platforms, but if
# none matches this exact image, npm falls back to compiling from
# source — these let that fallback succeed instead of failing the build.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY bindings ./bindings
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
