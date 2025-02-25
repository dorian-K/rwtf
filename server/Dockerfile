# Use a base image
FROM node:20

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

RUN npm run build

# Expose the port your application will run on
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start-without-build"]
