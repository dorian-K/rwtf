FROM python:3.12-slim

WORKDIR /app

# CPU-only torch keeps the image ~1 GB instead of pulling the CUDA build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir \
    https://github.com/mistralai/timestral/archive/a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff.tar.gz

COPY server.py .

# Weights (~0.8 GB for 209M) are downloaded on first start into the HF cache volume.
ENV HF_HOME=/cache
EXPOSE 8000
CMD ["python", "server.py"]
