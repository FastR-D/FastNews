FROM node:22-bookworm-slim AS frontend
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
ARG FASTNEWS_PUBLIC_PATH=
ENV FASTNEWS_PUBLIC_PATH=${FASTNEWS_PUBLIC_PATH}
RUN pnpm build

FROM golang:1.26.8-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -o /fastnews ./cmd/fastnews

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home fastnews
WORKDIR /app
COPY --from=backend /fastnews ./bin/fastnews
COPY --from=frontend /src/web/dist ./web/dist
ENV FASTNEWS_HOST=0.0.0.0 FASTNEWS_PORT=4173 FASTNEWS_ROOT=/data FASTNEWS_DATA_DIR=/state FASTNEWS_WEB_DIR=/app/web/dist
USER fastnews
EXPOSE 4173
CMD ["./bin/fastnews", "serve"]
