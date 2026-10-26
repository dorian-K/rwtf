# Dockerfile
FROM python:3.13-bookworm

# Install required dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    cron tzdata nano \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY crontab /etc/cron.d/my-cron-job

RUN chmod 0644 /etc/cron.d/my-cron-job

RUN crontab /etc/cron.d/my-cron-job

RUN mkdir /data
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

COPY run.sh .
RUN chmod +x run.sh

# one run at container start (cron's @reboot skips restarts of an existing container), then cron
CMD ["sh", "-c", "/app/run.sh & exec cron -f"]