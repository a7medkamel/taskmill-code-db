# https://github.com/nodegit/nodegit/issues/1361

from node:8-alpine as builder

WORKDIR /src

COPY . .

RUN rm -rf ./node_modules

RUN apk --no-cache add git

RUN apk update && \
    apk add --no-cache g++ libressl-dev make python curl-dev  && \
    npm install && \
    apk del g++ make python && \
    rm -rf /tmp/* /var/cache/apk/* && \
    npm cache clean --force

RUN BUILD_ONLY=true npm install

EXPOSE 8585
CMD [ "node", "index.js" ]
