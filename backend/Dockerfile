# Small, current Python base image.
FROM python:3.12-slim

WORKDIR /app

# Install deps first (in their own layer) so Docker caches them and only
# reinstalls when requirements.txt changes — not on every code edit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code.
COPY app ./app

# Run the API. 0.0.0.0 so it's reachable from outside the container.
# The port is fixed at 8000 inside the container; compose maps it to the host.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
