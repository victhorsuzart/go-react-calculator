FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
USER nonroot:nonroot
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --start-interval=1s --retries=3 \
  CMD ["/server", "-healthcheck"]
ENTRYPOINT ["/server"]
