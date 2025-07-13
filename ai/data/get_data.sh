#!/bin/bash

docker compose exec -i mariadb mariadb -u root -p'secret' -e "SELECT * FROM rwth_gym INTO OUTFILE '/tmp/out.csv' FIELDS TERMINATED BY ','ENCLOSED BY '"'LINES TERMINATED BY '\n';"

docker compose cp mariadb:/tmp/out.csv .