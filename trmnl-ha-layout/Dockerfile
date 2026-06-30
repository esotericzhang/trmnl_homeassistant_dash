FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
COPY tsconfig.json eslint.config.js ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=10000 LAYOUT_PATH=/data/layout.yaml
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY data ./data
EXPOSE 10000
CMD ["node", "dist/src/server.js"]
