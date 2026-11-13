# LifeQuest API — multi-stage image (small + fewer vulnerabilities).
#
# Stage 1 (builder): install Python dependencies. Build tools (gcc) live
# ONLY here — they never reach the final image.
# Stage 2 (runtime): a fresh slim image with ONLY the installed packages
# + the app code. No compiler, no apt lists, no pip cache.
#
# Why: a smaller image means a smaller attack surface — fewer OS packages
# that could carry vulnerabilities, and a faster pull/deploy.
# Note: this does NOT fix vulnerabilities in packages the app itself needs
# (e.g. starlette, a FastAPI dependency) — those need a dependency upgrade.
# It removes the *unneeded* stuff around them.

# ---------- Stage 1: builder ----------
FROM python:3.12-slim AS builder

WORKDIR /code

# Compiler + headers, only for building wheels (if a package needs it).
# This layer is discarded after the build — gcc never reaches the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching: requirements change
# far less often than application code). --prefix keeps them in one
# folder (/install) so the runtime stage can copy just that.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---------- Stage 2: runtime ----------
FROM python:3.12-slim

WORKDIR /code

# Copy ONLY the installed Python packages from the builder.
# No gcc, no apt cache, no pip cache in the final image.
COPY --from=builder /install /usr/local

# Copy the app code.
COPY app/ ./app/

EXPOSE 8000

# Compose overrides this with --reload for local development; the
# image default is the plain production-style command.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
