from node

COPY ./ /src

RUN cd /src                   && \
    NODE_ENV=production yarn  && \
    git init

from docker.breadboard.io/sandbox-lang-nodejs

COPY --from=0 /src /src
