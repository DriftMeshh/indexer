FROM node:22-slim

# pg (node-postgres) is a pure-JS driver — no native compilation needed,
# so we no longer require python3/make/g++ here. The image stays lean.

WORKDIR /app

COPY package.json package-lock.json ./
COPY bindings ./bindings
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
