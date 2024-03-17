# Use the official Node.js 14 image as the base image
FROM node:lts-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install the project dependencies
RUN npm install

# Copy the entire project directory to the working directory
COPY . .

# Build the Next.js project
RUN npm run build

RUN rm -rf /outbk/*
RUN mv /app/out/ /outbk
RUN rm -rf /app

CMD rm -rf /out/* && cp -a /outbk/. /out