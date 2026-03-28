FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir Pillow numpy requests

# Copy classification script
COPY classify.py /app/classify.py

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV TASK_TYPE=image-classification

CMD ["python", "/app/classify.py"]
