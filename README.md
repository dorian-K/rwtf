# Dev setup:

Install Docker and Node.js.

Run in two shells:

`docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build`

`cd webapp && npm run dev`

The webapp will be hosted on port 80, so open http://localhost/ in your browser