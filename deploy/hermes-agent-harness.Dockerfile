FROM nousresearch/hermes-agent:latest

USER root

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir \
      firecrawl-py \
      tavily-python \
      exa-py \
    && rm -rf /var/lib/apt/lists/*
