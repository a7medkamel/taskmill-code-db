"use strict";

var Promise       = require('bluebird')
  , _             = require('lodash')
  , GitHubApi     = require('github')
  ;

let hook_url = urljoin(config.getUrl('codedb'), 'hook');

class GitHub {
  constructor() {
  }

  set_hook(hostname, username, repository, token) {
    // try to hook / on success, update
    return Promise
            .try(() => {
              let info    = _.find(config.get('git.hosts'), { hostname })
                , url     = hook_url
                , secret  = _.get(info, 'hook.secret')
                , opts    = _.extend({ version: '3.0.0' }, info.options)
                , client  = new GitHubApi(opts)
                ;

              let msg = {
                  owner   : username
                , repo    : repository
                , name    : 'web'
                , events  : ['*']
                , config  : {
                      url
                    , content_type  : 'json'
                    , insecure_ssl  : '0'
                    , secret
                  }
              };

              client.authenticate({ type : 'oauth', token });

              client.repos.createHook(msg);
            });
  }
}

module.exports = GitHub;
