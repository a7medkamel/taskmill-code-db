sandbox_land_nodejs:
	cd ./data/sandbox																																		&& \
	docker build -f Dockerfile --no-cache -t docker.breadboard.io/sandbox-lang-nodejs . && \
	docker push docker.breadboard.io/sandbox-lang-nodejs

repository:
	docker build 																							  \
		-f $(dockerfile)                                          \
		--build-arg GPG_UID="git@breadboard.io"									  \
		--build-arg GPG_KEY="$$(cat ./key/pgp.asc)"							  \
		--build-arg GPG_PASSPHRASE="$$(cat ./key/pgp.passphrase)"	\
		--build-arg GIT_SHA=$(sha)				  											\
		-t $(tag)																								  \
		$(path)

git-crypt:
	docker run -it -v $(repo):/repo -v ${HOME}/.gnupg:/home/gitcrypt/.gnupg quay.io/lukebond/git-crypt:v1.0.0 "$@"


# make repository sha="8893e8ddfafecf19f175248cd1e938c2bb655320" tag="foomake" dockerfile="./data/repo/Dockerfile" path="./.db/github.com/breadboard-io/functions"
