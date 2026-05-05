FROM python:3.11-slim

# Install system dependencies needed by librosa, soundfile, and ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY ML/requirements.txt ./ML/requirements.txt
RUN pip install --no-cache-dir -r ML/requirements.txt

# Install backend Node dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy the rest of the project
COPY . .

# Expose backend port
EXPOSE 4000

# Start the backend
CMD ["node", "backend/server.js"]