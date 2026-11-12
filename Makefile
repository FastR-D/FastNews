.PHONY: install build build-release test test-browser dev-api dev-web package
install:
	go mod download
	pnpm --dir web install --frozen-lockfile
build:
	mkdir -p bin
	go build -trimpath -o bin/fastnews ./cmd/fastnews
	pnpm --dir web build
build-release:
	mkdir -p bin
	CGO_ENABLED=1 go build -trimpath -tags netgo,osusergo,sqlite_omit_load_extension -ldflags '-linkmode external -extldflags "-static"' -o bin/fastnews ./cmd/fastnews
	pnpm --dir web build
test:
	go test -race ./...
	go vet ./...
test-browser:
	FASTNEWS_PUBLIC_PATH=/ make build
	FASTNEWS_PUBLIC_PATH=/news pnpm --dir web exec vite build --outDir dist-news
	pnpm --dir web test
dev-api:
	FASTNEWS_COOKIE_SECURE=false go run ./cmd/fastnews serve
dev-web:
	pnpm --dir web dev
package:
	./scripts/package-release.sh
