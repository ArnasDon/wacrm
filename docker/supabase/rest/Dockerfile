# syntax=docker/dockerfile:1

# postgrest/postgrest:v12.2.3 on linux/amd64 (the CI arch) is a nix rootfs:
# a static musl binary at /bin/postgrest, no /bin/sh, no wget, no curl.
# A CMD-SHELL healthcheck can never succeed there. Copy that same pinned
# binary onto Alpine, which already ships wget, so compose can GET
# http://127.0.0.1:3001/ready without a shell.
#
# The linux/arm64 tag of the same image is different: an Ubuntu rootfs with
# a glibc binary at /usr/bin/postgrest (libpq, libgmp, zlib) and also no
# wget. That arch uses Ubuntu 24.04 — the same base the binary was linked
# against — plus wget, so `docker compose` on Apple Silicon still runs the
# pinned v12.2.3 binary.

FROM postgrest/postgrest:v12.2.3 AS upstream

FROM alpine:3.22.2 AS base-amd64
COPY --from=upstream /bin/postgrest /usr/local/bin/postgrest
# OpenSSL config the static binary looks up under its nix store path.
COPY --from=upstream /nix /nix
RUN chmod 755 /usr/local/bin/postgrest

FROM ubuntu:24.04 AS base-arm64
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      wget \
      ca-certificates \
      libpq5 \
      libgmp10 \
      zlib1g \
 && rm -rf /var/lib/apt/lists/*
COPY --from=upstream /usr/bin/postgrest /usr/local/bin/postgrest
RUN chmod 755 /usr/local/bin/postgrest

FROM base-${TARGETARCH}
USER 1000
EXPOSE 3000 3001
ENTRYPOINT ["/usr/local/bin/postgrest"]
