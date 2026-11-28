# Supply a verified immutable Python base image digest at build time.
ARG FIXTURE_BASE_IMAGE
FROM ${FIXTURE_BASE_IMAGE}
WORKDIR /opt/probe
COPY astra_sandbox_entrypoint.py ./
USER 10001:10001
WORKDIR /tmp
