# USING THIS TEMPLATE

Once you clone this template repo,
be sure to change the name by replacing `Qlever-LLC/oada-service-template`
(e.g., `sed -i 's/Qlever-LLC\/oada-service-template/trellisfw\/awesome-service/g' *`).

You probably will also want to update the license stuff.

Finally, remove this section from the README.

# Qlever-LLC/oada-service-template

[![Docker Pulls](https://img.shields.io/docker/pulls/Qlever-LLC/oada-service-template)][dockerhub]
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![License](https://img.shields.io/github/license/Qlever-LLC/oada-service-template)](LICENSE)

## Usage

Docker images for Qlever-LLC/oada-service-template are available from GitHub Container Registry.

### docker-compose

Here is an example of using this service with docker-compose.

```yaml
services:
  service:
    image: Qlever-LLC/oada-service-template
    restart: unless-stopped
    environment:
      NODE_TLS_REJECT_UNAUTHORIZED:
      NODE_ENV=: ${NODE_ENV:-development}
      DEBUG: ${DEBUG-*:error,*:warn,*:info}
      # Connect to host if DOMAIN not set.
      # You should really not rely on this though. Set DOMAIN.
      DOMAIN: ${DOMAIN:-host.docker.internal}
      # Unless your API server is running with development tokens enabled,
      # you will need to give the service token(s) to use.
      TOKEN: ${TOKEN:-abc123,def456}
```

### Running Qlever-LLC/oada-service-template within the [OADA Reference API Server]

To add this service to the services run with an OADA v3 server,
simply add a snippet like the one in the previous section
to your `docker-compose.override.yml`.

### External Usage

To run this service separately,
simply set the domain and token(s) of the OADA API.

```shell
# Set up the environment.
# Only need to run these the first time.
echo DOMAIN=api.oada.example.com > .env # Set API domain
echo TOKEN=abc123 >> .env # Set API token(s) for the service

# Start the service
docker-compose up -d
```

[dockerhub]: https://hub.docker.com/repository/docker/Qlever-LLC/oada-service-template
[oada reference api server]: https://github.com/OADA/server
