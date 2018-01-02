"use strict";

var Promise       = require('bluebird')
  , _             = require('lodash')
  , config        = require('config-url')
  , urljoin       = require('url-join')
  , GitHubApi     = require('github')
  ;

let hook_url = config.getUrl('git.hook_url');

class GitHub {
  constructor() {
  }

  static client(repository, options) {
    let conf      = repository.config()
      , opts      = _.extend({
                        version : '3.0.0'
                      , Promise
                    }, conf.options)
      , client    = new GitHubApi(opts)
      , { token } = options
      ;

    client.authenticate({ type : 'oauth', token });

    return { client, conf };
  }

  // try to hook / on success, update
  create_hook(repository, options) {
    return Promise
            .try(() => {
              let { conf, client }  = GitHub.client(repository, options)
                , owner             = repository.username()
                , repo              = repository.repo()
                , secret            = _.get(conf, 'hook.secret')
                , url               = hook_url
                ;

              let msg = {
                  owner
                , repo
                , name    : 'web'
                , events  : ['*']
                , config  : {
                      url
                    , content_type  : 'json'
                    , insecure_ssl  : '0'
                    , secret
                  }
              };

              return client.repos.createHook(msg);
            });
  }

  get_hooks(repository, options) {
    return Promise
            .try(() => {
              let { client }  = GitHub.client(repository, options)
                , owner       = repository.username()
                , repo        = repository.repo()
                ;

              let msg = {
                  owner
                , repo
                , per_page : 100
              };

              return client.repos.getHooks(msg);
            });
  }

  del_hook(repository, id, options) {
    return Promise
            .try(() => {
              let { client }  = GitHub.client(repository, options)
                , owner       = repository.username()
                , repo        = repository.repo()
                ;

              let msg = {
                  owner
                , repo
                , id
              };

              return client.repos.deleteHook(msg);
            });
  }

  clean_hooks(repository, options) {
    return this
            .get_hooks(repository, options)
            .then((hooks) => {
              // todo [akamel] hooks might be undefined.data
              return Promise
                      .map(hooks.data, (hook) => {
                        let { url } = hook.config;

                        if (_.startsWith(url, 'https://www.oncue.io')
                          || _.startsWith(url, 'http://www.taskmill.io')
                          || _.startsWith(url, 'https://www.taskmill.io')
                          || _.startsWith(url, 'https://www.breadboard.io')
                          || _.startsWith(url, 'http://192.168.1.6:1337')
                          || _.startsWith(url, 'http://localhost:1337')
                        ) {
                          return hook;
                        }
                      })
                      .then((arr) => {
                        let rm = _.chain(arr).compact().map(i => i.id).value();

                        return Promise.map(rm, (i) => this.del_hook(repository, i, options));
                      });
            });
  }
}

module.exports = GitHub;
