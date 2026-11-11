FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN mkdir -p /app/data
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/main.mjs"]
