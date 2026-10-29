# Use a base image
FROM node:lts-trixie

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

RUN npm run build

# geoip cache dir, writable by the non-root user (1000 = node) the override runs us as;
# a fresh named volume mounted here inherits this ownership
RUN mkdir -p geoip && chown node:node geoip

# Expose the port your application will run on
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start-without-build"]
