FROM node:20-bookworm

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
EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/start-firefox.sh"]
