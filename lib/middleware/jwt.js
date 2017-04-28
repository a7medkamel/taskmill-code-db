var Promise     = require('bluebird')
  , winston     = require('winston')
  , config      = require('config-url')
  , _           = require('lodash')
  , url         = require('url')
  , account_sdk = require('taskmill-core-account-sdk')
  ;

function token(req, res, next) {
  let token = _.get(req, 'body.token');

  if (token) {
    return next();
  }

  let bearer = req.get('Authorization');

  if (!bearer) {
    return next();
  }

  let remote = _.get(req, 'body.remote');
  if (!remote) {
    return next();
  }

  return Promise
          .try(() => {
            let { hostname } = url.parse(remote);

            return account_sdk
                    .findAccount({ bearer })
                    .then((account) => {
                      let name = hostname.replace('.com', '');
                      req.body.token = _.get(account, `accounts.${name}._token`);
                    });
          })
          // ignore err
          .catch((err) => {
            winston.error(err);
          })
          .asCallback(next);

}

module.exports = {
  token
};