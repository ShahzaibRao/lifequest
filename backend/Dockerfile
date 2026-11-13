# LifeQuest API — distroless image (minimal attack surface).
#
# Stage 1 (builder): install Python dependencies. Build tools (gcc) live
# ONLY here — they never reach the final image.
# Stage 2 (runtime): Google's distroless Python image. It contains ONLY
# Python + the app code. No shell, no apt, no mount/login/perl/ncurses
# and no other OS tools — so the OS vulnerabilities in those packages
# cannot exist in this image at all. Runs as non-root user (65532).
#
# Why distroless: the 49 remaining HIGHs in the slim image all live in
# Debian OS packages the web API never uses. Removing the packages
# removes the vulnerabilities. (Verified by Trivy on CI.)
#
# Python version MUST match between stages: the builder is python:3.13
# because distroless python3-debian13 is Python 3.13 (Debian 13).
# A 3.12 builder + 3.13 runtime would break compiled extensions (.so).
#
# Tradeoff: no shell in the image — `docker exec ... bash` does not
# work. Debug via `docker logs`, or use the :debug variant of the image
# (gcr.io/distroless/python3-debian13:debug, has a busybox shell).
# The app is started with `python3 -m uvicorn` — there is no `uvicorn`
# binary on PATH and no shell to resolve one.
#
# DISTROLESS_VARIANT picks the distroless flavour (used in Stage 2):
#   nonroot (default, production) — no shell, runs as user 65532.
#   debug   (staging)             — same Python/base/libs, plus a
#     busybox shell so you can `docker exec` in and debug.
# CI passes debug for the staging branch and nonroot for main, so
# staging matches production except for the shell.
# NOTE: this ARG MUST be declared before the first FROM — an ARG used
# in a FROM is only visible if declared in the global scope above it.
# (Declaring it between stages makes it undefined in the FROM line and
# the build fails with "invalid reference format".)
ARG DISTROLESS_VARIANT=nonroot

# ---------- Stage 1: builder ----------
FROM python:3.13-slim AS builder

WORKDIR /code

# Compiler + headers, only for building wheels (if a package needs it).
# This layer is discarded after the build — gcc never reaches the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching: requirements change
# far less often than application code). --target puts them in one flat
# folder (/app/deps) so the runtime stage can copy just that.
COPY requirements.txt .
RUN pip install --no-cache-dir --target /app/deps -r requirements.txt

# ---------- Stage 2: runtime (distroless) ----------
FROM gcr.io/distroless/python3-debian13:${DISTROLESS_VARIANT}

WORKDIR /app

# Copy ONLY the installed Python packages from the builder.
COPY --from=builder /app/deps /app/deps

# Copy the app code.
COPY app/ ./app/

# Make the flat deps dir importable (there is no site-packages here).
ENV PYTHONPATH=/app/deps

EXPOSE 8000

# Compose overrides this with --workers 2 for production; the image
# default is the plain command (also used by the CI smoke test).
# NOTE: distroless python3 already has ENTRYPOINT ["/usr/bin/python3"],
# so the CMD is ONLY the arguments to python — do NOT repeat the
# python3 path here, or python will try to run the python3 BINARY as
# a script (SyntaxError: source code cannot contain null bytes).
CMD ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
