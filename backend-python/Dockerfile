# Backend Python Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy dependency files
COPY pyproject.toml .
COPY uv.lock* .

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy source code
COPY agent_wechat ./agent_wechat

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8000

# Run the application
CMD ["uv", "run", "uvicorn", "agent_wechat.main:app", "--host", "0.0.0.0", "--port", "8000"]
