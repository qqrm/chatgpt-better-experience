FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    dbus-x11 \
    firefox-esr \
    fluxbox \
    imagemagick \
    novnc \
    procps \
    websockify \
    xdotool \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY docker/firefox-dev/start-firefox.sh /usr/local/bin/start-firefox.sh
RUN chmod +x /usr/local/bin/start-firefox.sh

WORKDIR /workspace
RUN mkdir -p /workspace/node_modules && chown -R node:node /workspace
USER node
EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/start-firefox.sh"]
