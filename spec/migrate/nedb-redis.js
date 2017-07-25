let fs      = require('fs')
  , _       = require('lodash')
  , redis   = require('redis')
  , config  = require('config-url')
  , Promise = require('bluebird')
  , Repository = require('../../lib/git/repository')
  ;

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

let fi = process.argv[2]
  , fo = process.argv[3]
  ;

let redis_client = redis.createClient({
    db              : config.get('codedb.redis.db')
  , host            : config.getUrlObject('codedb.redis').host
  , port            : config.getUrlObject('codedb.redis').port
  , password        : config.get('codedb.redis.password')
});

redis_client
  .flushdbAsync()
  .then(() => {
    fs.readFile(fi, 'utf8', (err, text) => {
      let arr = text.split(/\n/);

      let ret = _.chain(arr)
                  .compact()
                  .map(JSON.parse)
                  .map(i => {
                    let { remote, token } = i;

                    return {
                        repo  : new Repository(remote)
                      , token
                    }
                  })
                  .reverse()
                  .uniqBy(i => i.repo.key())
                  .reverse()
                  .value();

      Promise
        .map(ret, (i) => {
          return Promise
                  .all([
                    , i.repo.write_rec()
                    , i.repo.write_acl({ token : i.token })
                  ])
                  .then(() => {
                    return i.repo.list_acl().then((rec) => console.log(rec));
                  });
        })
        .catch((err) => {
          console.error(err);
        })
        .finally(() => {
          process.exit();
        })
    });
  });
