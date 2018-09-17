# https://github.com/nodegit/nodegit/issues/1361

from node:8-alpine as builder

WORKDIR /src

COPY . .

RUN rm -rf ./node_modules

RUN apk --no-cache add git

# RUN apk --no-cache add --virtual .build-deps g++ libressl-dev make python curl-dev && \
#     npm install && \
#     apk del .build-deps && \
#     apk --no-cache add libcurl libressl2.5-libtls && \
#     rm -rf /tmp/* /var/cache/apk/* && \
#     npm cache clean --force

RUN apk --no-cache add --virtual .build-deps zeromq-dev g++ libressl-dev make python curl-dev \
    && env BUILD_ONLY=true yarn install \
    && apk del .build-deps \
    && apk --no-cache add libcurl libressl2.7-libtls
    # && mv $(yarn cache dir)/npm-nodegit-[0-9]* /tmp/ \
    # && rm -rf $(yarn cache dir)/* \
    # && find /tmp/npm-nodegit-* -regex '.*/\(include\|src\|vendor\)$' -maxdepth 1 -exec rm -rf {} \; \
    # && find /tmp/npm-nodegit-*/lifecycleScripts/*install.js -exec sed -i '1s/^/return;\n/' {} \; \
    # && mv /tmp/npm-nodegit-* $(yarn cache dir)/ \
    # && find $(yarn global dir)/node_modules/nodegit -regex '.*/\(include\|src\|vendor\)$' -maxdepth 1 -exec rm -rf {} \; \
    # && rm -rf $(yarn global dir)/node_modules/nodegit/build/Release/.deps

EXPOSE 8585
CMD [ "node", "index.js" ]
