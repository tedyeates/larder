FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://cli.kiro.dev/install | bash
ENV PATH="/root/.local/bin:${PATH}"
RUN kiro-cli --version

WORKDIR /runner
COPY server.mjs ./
COPY agent ./agent
COPY mcp.json ./mcp.json

EXPOSE 8080
CMD ["node", "server.mjs"]
