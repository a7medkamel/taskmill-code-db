from node

RUN npm i -g git+https://github.com/a7medkamel/taskmill-sandbox-bootloader.git

RUN npm i -g git+https://github.com/a7medkamel/taskmill-sandbox-lang-nodejs.git

from node

COPY --from=0 /usr/local/bin/ /usr/local/bin/

COPY --from=0 /usr/local/lib/node_modules/ /usr/local/lib/node_modules/

EXPOSE 8080

WORKDIR /usr/local/lib/node_modules/taskmill-sandbox-bootloader/

CMD breadboard_sandbox_bootloader
