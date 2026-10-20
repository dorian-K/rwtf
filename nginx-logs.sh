#!/bin/sh
# Starts nginx with time-bounded logs. The access log (shortened client IPs) and the error log (full
# client IPs on request errors) go to files instead of Docker's log, are rotated daily, and are
# deleted after RETENTION_DAYS. The alpine image has no cron/logrotate, so a small loop does it.
DIR=/var/log/nginx/rwtf
RETENTION_DAYS=7
CHECK_SECONDS=${CHECK_SECONDS:-600}
mkdir -p "$DIR"

rotate() {
    today=$(date +%F)
    for f in access error; do
        log="$DIR/$f.log"
        [ -s "$log" ] || continue
        day=$(date -r "$log" +%F) # day of the newest entry
        [ "$day" = "$today" ] && continue
        # Move aside and reopen (nginx keeps writing to the moved file until then, so no lines are
        # lost), then append to the day's file in case it exists from an earlier restart.
        mv "$log" "$log.rotating"
        nginx -s reopen 2>/dev/null
        sleep 1 # reopen is asynchronous
        cat "$log.rotating" >> "$DIR/$f-$day.log" && rm "$log.rotating"
    done
    # Rotated files are named by day; delete those RETENTION_DAYS or more days old.
    cutoff=$(date -d "@$(($(date +%s) - RETENTION_DAYS * 86400))" +%Y%m%d)
    for old in "$DIR"/*-????-??-??.log; do
        [ -e "$old" ] || continue
        day=$(basename "$old" .log | grep -o '[0-9-]\{10\}$' | tr -d -)
        [ "$day" -le "$cutoff" ] && rm -f "$old"
    done
}

(while :; do
    rotate
    sleep "$CHECK_SECONDS"
done) &

exec nginx -g "daemon off;"
