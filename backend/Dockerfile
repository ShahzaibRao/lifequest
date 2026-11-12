# LifeQuest API — MVP skeleton image.
FROM python:3.12-slim

WORKDIR /code

# Install dependencies first (better layer caching: requirements change
# far less often than application code).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

# Compose overrides this with --reload for local development; the
# image default is the plain production-style command.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
