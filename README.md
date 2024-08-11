# Dev setup:

Install docker and nodejs

Run in two shells:

`docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build`

`cd webapp && npm run dev`

The webapp will be hosted on port 80, so open http://localhost/ in your browser
