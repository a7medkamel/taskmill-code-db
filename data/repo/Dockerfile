FROM buildpack-deps:jessie as decrypt

# Install git-crypt
RUN cd /tmp                                                                 && \
    git clone https://github.com/AGWA/git-crypt.git                         && \
    cd git-crypt                                                            && \
    make                                                                    && \
    make install PREFIX=/usr/local

# Install gnupg and gnupg-agent, gnupg-agent is used to keep and
# release the passphrase to git-crypt when the time comes
RUN apt-get update                                                          && \
    apt-get install -y gnupg                                                && \
    apt-get install -y gnupg-agent

# Load code into the /src folder
COPY ./ /repo.git

# Contains the GPG key's id `user@domain.com`
ARG GPG_UID=EMPTY
ENV GPG_UID ${GPG_UID}

# Contains the GPG key
ARG GPG_KEY=EMPTY
ENV GPG_KEY ${GPG_KEY}

# Contains the GPG key's passphrase
ARG GPG_PASSPHRASE=EMPTY
ENV GPG_PASSPHRASE ${GPG_PASSPHRASE}

ARG GIT_SHA
ENV GIT_SHA ${GIT_SHA}

WORKDIR /src

RUN git clone /repo.git ./    && \
    git checkout "$GIT_SHA" && ls ./

# 1. import the key into the gpg keyring
RUN if [ -d ".git-crypt" ]; then                                               \
    echo "${GPG_KEY}" | gpg --passphrase "${GPG_PASSPHRASE}" --import       && \
# 2. configure gpg to use the gpg-agent
    sed -i 's/# use-agent/use-agent/' ~/.gnupg/gpg.conf                     && \
# 3. configure gpg to operate in non-tty mode
    echo "no-tty" >> ~/.gnupg/gpg.conf                                      && \
# 4. start gpg-agent as a daemon and allow preset-passphrase
# |- GPG_AGENT_INFO=/tmp/gpg-wWKjdv/S.gpg-agent:8:1; export GPG_AGENT_INFO;
# |- eval output from gpg-agent start
    eval `gpg-agent --daemon --allow-preset-passphrase`                     && \
# 5. convert gpg passphrase to hex
    GPG_PASSPHRASE_HEX=`echo -n "$GPG_PASSPHRASE"                              \
                          | od -A n -t x1                                      \
                          | sed 's/ *//g'`                                  && \
# 6. extract gpg key's sub key fingerprint
    GPG_FINGERPRINT=`gpg --fingerprint --fingerprint $GPG_UID                  \
                      | grep -Po "Key fingerprint = (.*)"                      \
                      | tail -1                                                \
                      | sed 's/Key fingerprint = //' | sed 's/ *//g'`       && \
# 7. store gpg key's passphrase in agent
    gpg-connect-agent                                                          \
        "PRESET_PASSPHRASE $GPG_FINGERPRINT -1 $GPG_PASSPHRASE_HEX"            \
        /bye                                                                && \
# > these steps are not needed if you have a .git folder in your repo
# 8. ensure there is a git repo (incase this is a bare repository)
# git init                                                                && \
# 9. decrypt
    git-crypt unlock                                                           \
    ; fi

RUN rm -rf .git/branches .git/hooks .git/info .git/logs .git/objects .git/refs

from node:latest as npm

WORKDIR /src

COPY --from=decrypt /src .

RUN npm i

from gcr.io/breadboard-xyz/github-breadboard-xyz-sandbox-nodejs:8170e412dc7000a6577029062f91dd20428380e7 as sandbox

# WORKDIR /src

COPY --from=npm /src /src
