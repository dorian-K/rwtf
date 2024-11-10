# Dockerfile
FROM node:20

# Install required dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    cron tzdata nano \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-symbola \
    fonts-noto \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY crontab /etc/cron.d/my-cron-job

RUN chmod 0644 /etc/cron.d/my-cron-job

RUN crontab /etc/cron.d/my-cron-job

RUN mkdir /data
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

RUN npm install

COPY run.sh .
RUN chmod +x run.sh
COPY screenshot.js .

CMD ["cron", "-f"]