FROM python:3.11-slim

# Install system dependencies including build tools
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    binutils \
    file \
    && rm -rf /var/lib/apt/lists/*

# Create non-privileged user for running agent submissions
RUN useradd -m -s /bin/bash agentuser

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY agent_submission_service.py .
COPY index.html .
COPY mcp_server.py .
COPY start_services.sh .

# Copy challenge-related files
COPY challenge.cpp .
COPY build.sh .
COPY generate_callgraph.py .
COPY calculate_password.py .

# Make build script executable and build the challenge
RUN chmod +x build.sh && ./build.sh

# Copy flag file and set proper permissions
COPY flag /flag
RUN chmod 600 /flag
RUN chown root:root /flag

# Create directories for agent submissions and logs
RUN mkdir -p /app/submissions /app/logs
RUN chown -R agentuser:agentuser /app/submissions /app/logs

# Make startup script executable
RUN chmod +x start_services.sh

# Expose only the agent submission service port
EXPOSE 8001

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV FLAG_FILE=/flag

# Start all services
CMD ["./start_services.sh"]
