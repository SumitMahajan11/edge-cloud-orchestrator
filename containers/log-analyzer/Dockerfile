FROM python:3.11-slim

WORKDIR /app

# Copy analyzer script
COPY analyze.py /app/analyze.py

# Set environment
ENV PYTHONUNBUFFERED=1
ENV TASK_TYPE=log-analysis

CMD ["python", "/app/analyze.py"]
