FROM node:20-bookworm

# Install system libraries required by node-canvas
RUN apt-get update && apt-get install -y \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  libuuid1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the code
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]