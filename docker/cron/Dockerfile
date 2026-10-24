FROM alpine:3.22
RUN apk add --no-cache curl
COPY entrypoint.sh run-task.sh healthcheck.sh /
COPY crontab /etc/cron-template
RUN chmod +x /entrypoint.sh /run-task.sh /healthcheck.sh && mkdir -p /var/run/cron
# The HEALTHCHECK is declared in docker-compose.yml, not here.
ENTRYPOINT ["/entrypoint.sh"]
